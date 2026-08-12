import { serviceClient } from "../_shared/supabase.ts";
import { getPayment, verifyWebhookSignature } from "../_shared/mercadopago.ts";
import { generateTicketCode, signTicket } from "../_shared/tickets.ts";
import { fail, json } from "../_shared/http.ts";

// Mercado Pago considera entregada la notificación con cualquier 2xx; si
// respondemos error, reintenta.
const APROBADO = ["approved"];
const FALLIDO = ["rejected", "cancelled", "refunded", "charged_back"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const url = new URL(req.url);
  const rawBody = await req.text();

  let payload: Record<string, any> = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }

  // data.id viaja en la query; el cuerpo se usa como respaldo.
  const dataId = url.searchParams.get("data.id") ?? payload?.data?.id?.toString() ?? null;

  if (!await verifyWebhookSignature(req, url.searchParams.get("data.id"))) {
    console.warn("mercadopago-webhook: firma inválida");
    return fail("Firma inválida", 401);
  }

  const tipo = url.searchParams.get("type") ?? payload.type ?? "";

  // Solo interesan los pagos: merchant_order y demás avisos se descartan.
  if (tipo !== "payment") return json({ ok: true, ignored: tipo });
  if (!dataId) return json({ ok: true, ignored: "sin data.id" });

  const db = serviceClient();
  const eventId = `${payload.id ?? "sin-id"}:${dataId}:${payload.action ?? tipo}`;

  const { data: registrado, error: logError } = await db
    .from("webhook_events")
    .insert({ provider: "mercadopago", external_event_id: eventId, payload, status: "received" })
    .select("id")
    .maybeSingle();

  // La unicidad de (provider, external_event_id) evita emitir dos veces la misma
  // entrada cuando Mercado Pago reintenta.
  if (logError || !registrado) return json({ ok: true, duplicated: true });

  const cerrar = async (status: string, detalle?: string) => {
    await db
      .from("webhook_events")
      .update({ status, error_detail: detalle ?? null, processed_at: new Date().toISOString() })
      .eq("id", registrado.id);
  };

  // El estado real se consulta a la API: el webhook solo avisa que algo cambió.
  const pago = await getPayment(dataId);
  if (!pago) {
    await cerrar("error", `No se pudo leer el pago ${dataId}`);
    return fail("No se pudo leer el pago", 502);
  }

  const orderId = pago.externalReference;
  if (!orderId) {
    await cerrar("ignored", "El pago no trae external_reference");
    return json({ ok: true });
  }

  const { data: order } = await db
    .from("orders")
    .select("id, status, event_id, section_id, seat_id, buyer_name, buyer_lastname, buyer_document, buyer_whatsapp")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    await cerrar("ignored", `Orden desconocida: ${orderId}`);
    return json({ ok: true });
  }

  await db.from("orders").update({ provider_payment_id: pago.id }).eq("id", order.id);

  if (FALLIDO.includes(pago.status)) {
    await db.from("orders").update({ status: "failed" }).eq("id", order.id);
    if (order.seat_id) {
      await db
        .from("seats")
        .update({ status: "available", held_by: null, held_until: null })
        .eq("id", order.seat_id)
        .eq("status", "held");
    }
    await cerrar("processed");
    return json({ ok: true });
  }

  if (!APROBADO.includes(pago.status)) {
    // pending / in_process: se mantiene la reserva y se espera otro aviso.
    await cerrar("ignored", `Estado intermedio: ${pago.status}`);
    return json({ ok: true });
  }

  if (order.status === "paid") {
    await cerrar("ignored", "La orden ya estaba pagada");
    return json({ ok: true });
  }

  const { data: section } = await db
    .from("sections").select("code, label").eq("id", order.section_id).maybeSingle();

  let tableNumber: number | null = null;
  let seatNumber: number | null = null;
  if (order.seat_id) {
    const { data: seat } = await db
      .from("seats").select("number, table_id").eq("id", order.seat_id).maybeSingle();
    seatNumber = seat?.number ?? null;
    if (seat?.table_id) {
      const { data: table } = await db
        .from("tables").select("number").eq("id", seat.table_id).maybeSingle();
      tableNumber = table?.number ?? null;
    }
  }

  const code = generateTicketCode(section?.code ?? "GEN");
  const qrSignature = await signTicket(code);

  const { data: ticket, error: ticketError } = await db
    .from("tickets")
    .insert({
      order_id: order.id,
      event_id: order.event_id,
      section_id: order.section_id,
      code,
      qr_signature: qrSignature,
      section_code: section?.code ?? "GEN",
      section_label: section?.label ?? "General",
      table_number: tableNumber,
      seat_number: seatNumber,
      buyer_name: order.buyer_name,
      buyer_lastname: order.buyer_lastname,
      buyer_document: order.buyer_document,
      buyer_whatsapp: order.buyer_whatsapp,
    })
    .select("id")
    .single();

  if (ticketError || !ticket) {
    await cerrar("error", ticketError?.message ?? "No se pudo emitir el ticket");
    return fail("No se pudo emitir el ticket", 500);
  }

  await db.from("orders").update({ status: "paid" }).eq("id", order.id);

  if (order.seat_id) {
    await db
      .from("seats")
      .update({ status: "occupied", held_by: null, held_until: null, ticket_id: ticket.id })
      .eq("id", order.seat_id);
  }

  await cerrar("processed");
  return json({ ok: true });
});
