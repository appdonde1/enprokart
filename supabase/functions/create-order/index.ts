import { serviceClient } from "../_shared/supabase.ts";
import { createPixPayment } from "../_shared/mercadopago.ts";
import { fail, json, preflight } from "../_shared/http.ts";

const HOLD_MINUTES = 15;

type Body = {
  event_slug?: string;
  section_code?: string;
  table_number?: number | null;
  seat_number?: number | null;
  buyer?: {
    nombre?: string;
    apellido?: string;
    documento?: string;
    whatsapp?: string;
  };
};

function cleanText(value: unknown, max = 120): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const nombre = cleanText(body.buyer?.nombre);
  const apellido = cleanText(body.buyer?.apellido);
  const documento = cleanText(body.buyer?.documento, 40);
  const whatsapp = cleanText(body.buyer?.whatsapp, 40);

  if (!nombre || !apellido || !documento || !whatsapp) {
    return fail("Faltan datos del comprador (nombre, apellido, documento y WhatsApp son obligatorios)");
  }
  if (whatsapp.replace(/\D/g, "").length < 10) {
    return fail("El número de WhatsApp no parece válido");
  }
  if (!body.event_slug || !body.section_code) {
    return fail("Falta el evento o la sección");
  }

  const db = serviceClient();

  const { data: event } = await db
    .from("events")
    .select("id, name, status")
    .eq("slug", body.event_slug)
    .maybeSingle();

  if (!event || event.status !== "published") return fail("El evento no está disponible", 404);

  const { data: section } = await db
    .from("sections")
    .select("id, code, label, price_cents, assignment_mode")
    .eq("event_id", event.id)
    .eq("code", body.section_code)
    .maybeSingle();

  if (!section) return fail("Sección inexistente", 404);

  // La orden se crea antes del hold porque `seats.held_by` apunta a ella.
  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      event_id: event.id,
      section_id: section.id,
      buyer_name: nombre,
      buyer_lastname: apellido,
      buyer_document: documento,
      buyer_whatsapp: whatsapp,
      // El precio sale de la base, nunca del cliente.
      amount_cents: section.price_cents,
    })
    .select("id")
    .single();

  if (orderError || !order) return fail("No se pudo iniciar la compra", 500);

  const rollback = async () => {
    await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
  };

  let heldSeat: { id: string; table_id: string; number: number } | null = null;

  if (section.assignment_mode === "manual") {
    if (!body.table_number || !body.seat_number) {
      await rollback();
      return fail("Selecciona una mesa y una silla");
    }

    const { data: table } = await db
      .from("tables")
      .select("id")
      .eq("section_id", section.id)
      .eq("number", body.table_number)
      .maybeSingle();

    if (!table) {
      await rollback();
      return fail("La mesa no existe", 404);
    }

    const { data: seat } = await db
      .from("seats")
      .select("id")
      .eq("table_id", table.id)
      .eq("number", body.seat_number)
      .maybeSingle();

    if (!seat) {
      await rollback();
      return fail("La silla no existe", 404);
    }

    const { data: held } = await db.rpc("hold_seat_manual", {
      p_seat_id: seat.id,
      p_order_id: order.id,
      p_ttl_minutes: HOLD_MINUTES,
    });

    heldSeat = Array.isArray(held) ? held[0] ?? null : held;
    if (!heldSeat) {
      await rollback();
      return fail("Esa silla acaba de ser reservada por otra persona", 409, { seat_taken: true });
    }
  } else if (section.assignment_mode === "auto_fcfs") {
    // El comprador no elige: se le asigna la próxima libre por orden de llegada.
    const { data: held } = await db.rpc("hold_seat_auto_fcfs", {
      p_section_id: section.id,
      p_order_id: order.id,
      p_ttl_minutes: HOLD_MINUTES,
    });

    heldSeat = Array.isArray(held) ? held[0] ?? null : held;
    if (!heldSeat) {
      await rollback();
      return fail("La sección está agotada", 409, { sold_out: true });
    }
  }

  let tableNumber: number | null = null;
  if (heldSeat) {
    const { data: table } = await db
      .from("tables")
      .select("number")
      .eq("id", heldSeat.table_id)
      .maybeSingle();
    tableNumber = table?.number ?? null;

    await db
      .from("orders")
      .update({ table_id: heldSeat.table_id, seat_id: heldSeat.id })
      .eq("id", order.id);
  }

  const releaseSeat = async () => {
    if (!heldSeat) return;
    await db
      .from("seats")
      .update({ status: "available", held_by: null, held_until: null })
      .eq("id", heldSeat.id)
      .eq("status", "held");
  };

  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();

  const ubicacion = heldSeat
    ? `Mesa ${tableNumber} · Silla ${heldSeat.number}`
    : "Acceso general";

  let pix;
  try {
    pix = await createPixPayment({
      orderId: order.id,
      amountCents: section.price_cents,
      description: `${event.name} · ${section.label} · ${ubicacion}`,
      expiresAt,
      notificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
      buyer: { name: nombre, lastname: apellido, document: documento, whatsapp },
    });
  } catch (error) {
    await releaseSeat();
    await db.from("orders").update({ status: "failed" }).eq("id", order.id);
    console.error("create-order/mercadopago", error);
    return fail("No se pudo generar el cobro PIX. Intenta de nuevo.", 502);
  }

  await db
    .from("orders")
    .update({
      provider_ref: pix.paymentId,
      provider_payment_id: pix.paymentId,
      pix_qr_code: pix.qrCode,
      pix_qr_base64: pix.qrCodeBase64,
      expires_at: expiresAt,
    })
    .eq("id", order.id);

  return json({
    order_id: order.id,
    amount_cents: section.price_cents,
    section: { code: section.code, label: section.label },
    table_number: tableNumber,
    seat_number: heldSeat?.number ?? null,
    pix_qr_code: pix.qrCode,
    pix_qr_base64: pix.qrCodeBase64,
    expires_at: expiresAt,
  });
});
