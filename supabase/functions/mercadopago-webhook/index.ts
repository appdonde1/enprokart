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
    .select("id, status, event_id, section_id, seat_id, people, tables_count, buyer_name, buyer_lastname, buyer_document, buyer_whatsapp")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    await cerrar("ignored", `Orden desconocida: ${orderId}`);
    return json({ ok: true });
  }

  await db.from("orders").update({ provider_payment_id: pago.id }).eq("id", order.id);

  if (FALLIDO.includes(pago.status)) {
    await db.from("orders").update({ status: "failed" }).eq("id", order.id);
    // Se sueltan todas las mesas que esta compra tenía reservadas.
    await db
      .from("seats")
      .update({ status: "available", held_by: null, held_until: null })
      .eq("held_by", order.id)
      .eq("status", "held");
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

  /* El documento lo pone quien pagó, no quien llenó el formulario.

     El sitio dejó de pedirlo: pedir un número que la pasarela ya conoce es
     hacer tipear un dato para después no poder confirmarlo. Mercado Pago
     devuelve la identificación de la cuenta que hizo la transferencia, y ése
     es el que sirve en la puerta, porque es el que está respaldado por el pago.

     Si el pago no trae identificación —puede pasar—, la entrada sale igual con
     el documento vacío: el nombre y el WhatsApp alcanzan para encontrarla. */
  const documentoDelPago = pago.payer?.document ?? "";
  if (documentoDelPago && documentoDelPago !== order.buyer_document) {
    await db.from("orders").update({ buyer_document: documentoDelPago }).eq("id", order.id);
    order.buyer_document = documentoDelPago;
  }

  const { data: section } = await db
    .from("sections").select("code, label").eq("id", order.section_id).maybeSingle();

  // Se emite una entrada por persona: cada invitado entra con su propio QR.
  const personas = Math.max(1, order.people ?? 1);

  const { data: mesas } = await db
    .from("order_tables").select("table_code").eq("order_id", order.id).order("table_code");

  const codigosMesa: string[] = (mesas ?? []).map((m: any) => m.table_code);

  const entradas = [];
  for (let i = 0; i < personas; i++) {
    const code = generateTicketCode(section?.code ?? "GEN");
    entradas.push({
      order_id: order.id,
      event_id: order.event_id,
      section_id: order.section_id,
      code,
      qr_signature: await signTicket(code),
      section_code: section?.code ?? "GEN",
      section_label: section?.label ?? "General",
      // Los invitados se reparten entre las mesas compradas, en orden.
      table_code: codigosMesa.length
        ? codigosMesa[Math.min(codigosMesa.length - 1, Math.floor(i / Math.ceil(personas / codigosMesa.length)))]
        : null,
      table_number: null,
      seat_number: null,
      guest_index: i + 1,
      buyer_name: order.buyer_name,
      buyer_lastname: order.buyer_lastname,
      buyer_document: order.buyer_document,
      buyer_whatsapp: order.buyer_whatsapp,
    });
  }

  const { data: emitidas, error: ticketError } = await db
    .from("tickets").insert(entradas).select("id");

  if (ticketError || !emitidas?.length) {
    // El pago entró y las entradas no salieron: es el peor estado posible. Se
    // deja la orden marcada como pagada igual, porque el dinero está cobrado y
    // negarlo sería peor; el panel de Operaciones lista las compras pagadas sin
    // entradas para que alguien las resuelva a mano. Se devuelve 500 a propósito:
    // Mercado Pago reintenta la notificación y el problema puede resolverse solo.
    await db
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);

    await cerrar("error", ticketError?.message ?? "No se pudieron emitir las entradas");
    console.error("mercadopago-webhook/emision", order.id, ticketError);
    return fail("No se pudieron emitir las entradas", 500);
  }

  await db
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.id);

  // Las mesas reservadas pasan a ocupadas.
  await db
    .from("seats")
    .update({ status: "occupied", held_by: null, held_until: null, ticket_id: emitidas[0].id })
    .eq("held_by", order.id);

  await cerrar("processed");
  return json({ ok: true, tickets: emitidas.length });
});
