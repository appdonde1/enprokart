import { serviceClient } from "../_shared/supabase.ts";
import { authenticateWebhook } from "../_shared/pagarme.ts";
import { generateTicketCode, signTicket } from "../_shared/tickets.ts";
import { fail, json } from "../_shared/http.ts";

const PAID_EVENTS = ["order.paid", "charge.paid"];
const FAILED_EVENTS = [
  "order.payment_failed",
  "order.canceled",
  "charge.payment_failed",
  "charge.refunded",
  "charge.canceled",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Enviamos nuestro id de orden como `code` y como `metadata.order_id`. Según el
// evento sea de pedido o de cobranza, vuelve en distinta posición del payload.
function findOrderId(payload: Record<string, any>): string | null {
  const data = payload?.data ?? {};
  const candidates = [
    data.code,
    data.metadata?.order_id,
    data.order?.code,
    data.order?.metadata?.order_id,
    data.charges?.[0]?.code,
  ];
  return candidates.find((value) => typeof value === "string" && UUID.test(value)) ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const rawBody = await req.text();

  if (!await authenticateWebhook(req, rawBody)) {
    console.warn("pagarme-webhook: credenciales inválidas");
    return fail("No autorizado", 401);
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();
  const eventId = payload.id ?? crypto.randomUUID();
  const eventType: string = payload.type ?? "";

  // Pagar.me reintenta: la unicidad de (provider, external_event_id) hace que el
  // segundo intento no vuelva a emitir el ticket.
  const { data: logged, error: logError } = await db
    .from("webhook_events")
    .insert({ external_event_id: eventId, payload, status: "received" })
    .select("id")
    .maybeSingle();

  if (logError || !logged) return json({ ok: true, duplicated: true });

  const finish = async (status: string, detail?: string) => {
    await db
      .from("webhook_events")
      .update({ status, error_detail: detail ?? null, processed_at: new Date().toISOString() })
      .eq("id", logged.id);
  };

  const orderRef = findOrderId(payload);
  if (!orderRef) {
    await finish("ignored", "El evento no trae referencia de orden");
    return json({ ok: true });
  }

  const { data: order } = await db
    .from("orders")
    .select("id, status, event_id, section_id, table_id, seat_id, buyer_name, buyer_lastname, buyer_document, buyer_whatsapp")
    .eq("id", orderRef)
    .maybeSingle();

  if (!order) {
    await finish("ignored", `Orden desconocida: ${orderRef}`);
    return json({ ok: true });
  }

  if (FAILED_EVENTS.includes(eventType)) {
    await db.from("orders").update({ status: "failed" }).eq("id", order.id);
    if (order.seat_id) {
      await db
        .from("seats")
        .update({ status: "available", held_by: null, held_until: null })
        .eq("id", order.seat_id)
        .eq("status", "held");
    }
    await finish("processed");
    return json({ ok: true });
  }

  if (!PAID_EVENTS.includes(eventType)) {
    await finish("ignored", `Tipo no manejado: ${eventType}`);
    return json({ ok: true });
  }

  if (order.status === "paid") {
    await finish("ignored", "La orden ya estaba pagada");
    return json({ ok: true });
  }

  const { data: section } = await db
    .from("sections")
    .select("code, label")
    .eq("id", order.section_id)
    .maybeSingle();

  let tableNumber: number | null = null;
  let seatNumber: number | null = null;
  if (order.seat_id) {
    const { data: seat } = await db
      .from("seats")
      .select("number, table_id")
      .eq("id", order.seat_id)
      .maybeSingle();
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
    await finish("error", ticketError?.message ?? "No se pudo emitir el ticket");
    return fail("No se pudo emitir el ticket", 500);
  }

  await db.from("orders").update({ status: "paid" }).eq("id", order.id);

  if (order.seat_id) {
    await db
      .from("seats")
      .update({ status: "occupied", held_by: null, held_until: null, ticket_id: ticket.id })
      .eq("id", order.seat_id);
  }

  await finish("processed");
  return json({ ok: true });
});
