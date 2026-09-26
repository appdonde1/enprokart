import { serviceClient } from "../_shared/supabase.ts";
import { CAIDO, PAGADO, obtenerCobro, reembolsar, tokenValido } from "../_shared/asaas.ts";
import { generateTicketCode, signTicket } from "../_shared/tickets.ts";
import { notificarTelegram } from "../_shared/telegram.ts";
import { enviarEntradasPorCorreo } from "../_shared/email.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Avisos de cobro de Asaas.
 *
 * Asaas da por entregada la notificación con cualquier 2xx; si respondemos
 * error, reintenta. Por eso los casos que no nos sirven se contestan 200 con
 * una nota, y solo se devuelve error cuando de verdad queremos que reintente.
 */

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  if (!tokenValido(req)) {
    console.warn("asaas-webhook: token inválido");
    return fail("No autorizado", 401);
  }

  const cuerpo = await req.json().catch(() => null);
  if (!cuerpo) return json({ ok: true, ignored: "cuerpo ilegible" });

  const evento = String(cuerpo.event ?? "");
  const pagoId = cuerpo.payment?.id ? String(cuerpo.payment.id) : "";
  if (!pagoId) return json({ ok: true, ignored: "sin payment.id" });

  const db = serviceClient();

  /* La unicidad de (provider, external_event_id) evita emitir dos veces la
     misma entrada cuando Asaas reintenta el aviso. */
  const idEvento = `${cuerpo.id ?? "sin-id"}:${pagoId}:${evento}`;
  const { data: registrado, error: logError } = await db
    .from("webhook_events")
    .insert({ provider: "asaas", external_event_id: idEvento, payload: cuerpo, status: "received" })
    .select("id")
    .maybeSingle();

  if (logError || !registrado) return json({ ok: true, duplicated: true });

  const cerrar = async (status: string, detalle?: string) => {
    await db.from("webhook_events")
      .update({ status, error_detail: detalle ?? null, processed_at: new Date().toISOString() })
      .eq("id", registrado.id);
  };

  // El estado real se consulta a la API: el aviso solo dice que algo cambió.
  const pago = await obtenerCobro(pagoId);
  if (!pago) {
    await cerrar("error", `No se pudo leer el cobro ${pagoId}`);
    return fail("No se pudo leer el cobro", 502);
  }

  const orderId = pago.externalReference;
  if (!orderId) {
    await cerrar("ignored", "El cobro no trae externalReference");
    return json({ ok: true });
  }

  const { data: order } = await db
    .from("orders")
    .select("id, order_number, status, event_id, section_id, people, buyer_name, buyer_lastname, buyer_document, buyer_whatsapp, buyer_email, amount_cents")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    await cerrar("ignored", `Orden desconocida: ${orderId}`);
    return json({ ok: true });
  }

  await db.from("orders")
    .update({ provider_payment_id: pago.id, provider_ref: pago.id })
    .eq("id", order.id);

  // ------------------------------------------------ pagos caídos
  if (CAIDO.includes(pago.status)) {
    await db.from("orders").update({ status: "failed" }).eq("id", order.id);
    await db.from("seats")
      .update({ status: "available", held_by: null, held_until: null })
      .eq("held_by", order.id)
      .eq("status", "held");
    await cerrar("processed", `Cobro en estado ${pago.status}`);
    return json({ ok: true });
  }

  if (!PAGADO.includes(pago.status)) {
    // PENDING y demás: se mantiene la reserva y se espera otro aviso.
    await cerrar("ignored", `Estado intermedio: ${pago.status}`);
    return json({ ok: true });
  }

  if (order.status === "paid") {
    await cerrar("ignored", "La orden ya estaba pagada");
    return json({ ok: true });
  }

  /* ------------------------------------------------ la red contra sobreventa
     El QR de Asaas no vence en minutos: vive hasta el fin del día. La reserva
     de la mesa dura cinco. `expire-holds` cancela la cobranza al soltar la
     mesa, pero entre que la reserva vence y la cancelación llega hay una
     rendija, y alguien puede pagar ahí.

     Si las mesas de esta orden ya no están retenidas para ella, la mesa se
     revendió. Emitir la entrada pondría a dos grupos en el mismo lugar, así
     que se devuelve la plata. Es mal negocio y es lo correcto. */
  const { count: retenidas } = await db
    .from("seats")
    .select("id", { count: "exact", head: true })
    .eq("held_by", order.id);

  const { data: mesasCompradas } = await db
    .from("order_tables").select("table_code").eq("order_id", order.id).order("table_code");
  const codigosMesa: string[] = (mesasCompradas ?? []).map((m: any) => m.table_code);

  // Solo aplica a las compras con mesa: General no retiene nada.
  if (codigosMesa.length && !retenidas) {
    const devuelto = await reembolsar(
      pago.id,
      "La reserva venció y la mesa volvió a la venta antes de que entrara el pago.",
    );
    await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
    await cerrar(
      "error",
      devuelto
        ? "Pago fuera de tiempo: mesa ya revendida, se devolvió el importe"
        : "Pago fuera de tiempo y el reembolso falló: revisar a mano",
    );
    console.error("asaas-webhook/fuera-de-tiempo", order.id, pago.id, "reembolso:", devuelto);
    return json({ ok: true, refunded: devuelto });
  }

  // ------------------------------------------------ emisión
  const { data: section } = await db
    .from("sections").select("code, label").eq("id", order.section_id).maybeSingle();

  const personas = Math.max(1, order.people ?? 1);
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
    /* El pago entró y las entradas no salieron: es el peor estado posible. La
       orden queda pagada igual, porque el dinero está cobrado y negarlo sería
       peor; Operaciones lista las compras pagadas sin entradas para resolverlas
       a mano. Se devuelve 500 a propósito: Asaas reintenta y puede resolverse
       solo. */
    await db.from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);
    await cerrar("error", ticketError?.message ?? "No se pudieron emitir las entradas");
    console.error("asaas-webhook/emision", order.id, ticketError);
    return fail("No se pudieron emitir las entradas", 500);
  }

  await db.from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.id);

  await db.from("seats")
    .update({ status: "occupied", held_by: null, held_until: null, ticket_id: emitidas[0].id })
    .eq("held_by", order.id);

  // Cargar datos del evento para el correo y la notificación
  const { data: event } = await db
    .from("events")
    .select("name, event_date")
    .eq("id", order.event_id)
    .maybeSingle();

  const fechaFormateada = event?.event_date
    ? new Date(event.event_date).toLocaleDateString("es", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  // 1. Notificar por Telegram a los 3 IDs configurados
  await notificarTelegram({
    orderNumber: order.order_number,
    buyerName: `${order.buyer_name} ${order.buyer_lastname}`.trim(),
    buyerDocument: order.buyer_document,
    buyerWhatsapp: order.buyer_whatsapp,
    buyerEmail: order.buyer_email,
    sectionLabel: section?.label ?? "General",
    tables: codigosMesa.length ? codigosMesa.join(", ") : null,
    people: personas,
    amountCents: order.amount_cents ?? 0,
    // Lo que Asaas acredita después de su comisión, tal como lo informa el
    // cobro. El número que cuadra con el banco al centavo es el del reporte
    // semanal, que lee el extracto.
    netCents: pago.netValueCents,
    ticketsCount: emitidas.length,
  }).catch((e) => console.error("asaas-webhook/telegram_error:", e));

  // 2. Enviar entradas con código y QR por correo
  if (order.buyer_email) {
    const entradasEmail = entradas.map((t) => ({
      code: t.code,
      qrSignature: t.qr_signature,
      tableCode: t.table_code,
      guestIndex: t.guest_index,
    }));

    await enviarEntradasPorCorreo({
      destinatario: order.buyer_email,
      nombreComprador: `${order.buyer_name} ${order.buyer_lastname}`.trim(),
      documento: order.buyer_document,
      orderNumber: order.order_number,
      eventoNombre: event?.name ?? "Pro Kart",
      eventoFecha: fechaFormateada,
      seccionNombre: section?.label ?? "General",
      mesas: codigosMesa.length ? codigosMesa.join(", ") : null,
      entradas: entradasEmail,
    }).catch((e) => console.error("asaas-webhook/email_error:", e));
  }

  await cerrar("processed");
  return json({ ok: true, tickets: emitidas.length });
});
