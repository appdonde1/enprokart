import { serviceClient } from "../_shared/supabase.ts";
import { cancelarCobro, crearCobroPix } from "../_shared/asaas.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Apaga las cobranzas de reservas que ya vencieron.
 *
 * El QR de Asaas vive hasta doce meses; la reserva de la mesa, cinco minutos.
 * Si la cobranza sigue viva después de soltar la mesa, alguien puede pagar un
 * lugar que ya se revendió.
 *
 * Esto debería hacerlo el cron, pero no puede: pg_cron corre SQL puro y pg_net
 * no está habilitado, así que desde la base no hay forma de llamar a Asaas.
 * Se hace acá, y no es un rodeo: una mesa solo se revende pasando por esta
 * función, así que barrer antes de tomar una mesa cierra la ventana justo
 * donde el peligro existe.
 *
 * Va acotado a unas pocas por llamada: una compra no puede ponerse lenta
 * porque haya cien cobranzas viejas colgando. Las que sobran caen en la
 * siguiente compra, y la red del webhook cubre lo que se escape. */
const BARRIDO_MAX = 8;

async function apagarCobranzasVencidas(db: any): Promise<void> {
  const { data: viejas } = await db
    .from("orders")
    .select("id, provider_payment_id")
    .in("status", ["expired", "canceled", "failed"])
    .not("provider_payment_id", "is", null)
    .is("charge_canceled_at", null)
    .limit(BARRIDO_MAX);

  if (!viejas?.length) return;

  await Promise.all(viejas.map(async (o: any) => {
    // Si Asaas rechaza la cancelación porque ya estaba pagada o borrada, se
    // marca igual: reintentarla en cada compra no la va a arreglar, y la red
    // del webhook se ocupa del caso en que sí entró plata.
    const ok = await cancelarCobro(o.provider_payment_id).catch(() => false);
    await db.from("orders")
      .update({ charge_canceled_at: new Date().toISOString() })
      .eq("id", o.id);
    if (!ok) console.warn("create-order/barrido: Asaas no canceló", o.provider_payment_id);
  }));
}

/* Inicia una compra.

   El precio de una sección es POR PERSONA. Una mesa se toma completa, así que
   se cobra completa: seis sillas a 400 son 2.400, vayan seis o vayan dos. Es la
   misma regla que ya rige la reserva —la mesa no se comparte—, aplicada al
   cobro.

   Antes `price_cents` era el precio de la mesa entera y una mesa de seis salía
   400 en total, unos 66 por cabeza.

   El precio siempre sale de la base, nunca de lo que mande el navegador. */

/* Cuánto vive la reserva mientras el comprador paga.

   Con Mercado Pago este plazo era también el del QR. Con Asaas no: su QR vive
   hasta doce meses y no hay forma de acortarlo, así que este número es lo único
   que limita la ventana de pago. Cuando vence, la mesa vuelve a la venta y la
   cobranza se apaga en el próximo barrido. */
const HOLD_MINUTES = 5;
const MAX_MESAS = 8;
const MAX_PERSONAS = 60;

type Body = {
  event_slug?: string;
  table_codes?: string[];
  section_code?: string;
  people?: number;
  buyer?: {
    nombre?: string;
    apellido?: string;
    documento?: string;
    whatsapp?: string;
    email?: string;
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
  // El documento ya no se pide en el formulario: lo trae el pago. Se sigue
  // aceptando por si alguna versión vieja de la página lo manda.
  const documento = cleanText(body.buyer?.documento, 40);
  const whatsapp = cleanText(body.buyer?.whatsapp, 40);
  const emailBruto = cleanText(body.buyer?.email, 120);
  const email = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(emailBruto) ? emailBruto : "";

  if (!nombre || !apellido || !whatsapp) {
    return fail("Faltan datos del comprador: nombre, apellido y WhatsApp");
  }
  if (whatsapp.replace(/\D/g, "").length < 10) {
    return fail("El número de WhatsApp no parece válido");
  }
  if (!body.event_slug) return fail("Falta el evento");

  const personas = Math.floor(Number(body.people ?? 0));
  if (!Number.isFinite(personas) || personas < 1 || personas > MAX_PERSONAS) {
    return fail("Indica cuántas personas son");
  }

  const db = serviceClient();

  // Antes de tomar una mesa: apagar las cobranzas de las que ya se soltaron.
  await apagarCobranzasVencidas(db).catch((e) => console.error("create-order/barrido", e));

  const { data: event } = await db
    .from("events").select("id, name, status").eq("slug", body.event_slug).maybeSingle();
  if (!event || event.status !== "published") return fail("El evento no está disponible", 404);

  const codigos = Array.isArray(body.table_codes)
    ? [...new Set(body.table_codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
    : [];

  // ------------------------------------------------ sin plano: Plata y General
  if (!codigos.length) {
    const seccion = cleanText(body.section_code, 20).toUpperCase();
    if (!seccion) return fail("Elige una mesa en el plano o una sección");

    const { data: section } = await db
      .from("sections")
      .select("id, code, label, price_cents, assignment_mode, capacity")
      .eq("event_id", event.id).eq("code", seccion).maybeSingle();

    if (!section) return fail("Sección inexistente", 404);
    if (section.assignment_mode === "manual") {
      return fail("En esta sección hay que elegir la mesa en el plano");
    }

    // Plata: se compran mesas enteras aunque el comprador no elija cuáles.
    if (section.assignment_mode === "auto_fcfs") {
      const { data: muestra } = await db
        .from("tables").select("seat_count").eq("section_id", section.id).limit(1).maybeSingle();

      const porMesa = muestra?.seat_count ?? 4;
      const mesasNecesarias = Math.ceil(personas / porMesa);
      // Por persona, y la mesa asignada se paga entera igual que en el plano.
      const montoCents = section.price_cents * porMesa * mesasNecesarias;

      const { data: order, error: orderError } = await db
        .from("orders")
        .insert({
          event_id: event.id,
          section_id: section.id,
          buyer_name: nombre,
          buyer_lastname: apellido,
          buyer_document: documento,
          buyer_whatsapp: whatsapp,
          amount_cents: montoCents,
          people: personas,
          tables_count: mesasNecesarias,
        })
        .select("id")
        .single();

      if (orderError || !order) return fail("No se pudo iniciar la compra", 500);

      const { data: tomadas, error: holdError } = await db.rpc("hold_next_tables", {
        p_section_id: section.id,
        p_order_id: order.id,
        p_cantidad: mesasNecesarias,
        p_ttl_minutes: HOLD_MINUTES,
      });

      // Sin esto, un fallo de la función se confundiría con "no hay lugar".
      if (holdError) {
        await db.from("orders").update({ status: "failed" }).eq("id", order.id);
        console.error("create-order/hold_next_tables", holdError);
        return fail("No se pudo reservar la mesa. Intenta de nuevo.", 500);
      }

      const asignadas = Array.isArray(tomadas) ? tomadas : [];
      if (asignadas.length < mesasNecesarias) {
        await db.from("seats")
          .update({ status: "available", held_by: null, held_until: null })
          .eq("held_by", order.id);
        await db.from("orders").update({ status: "canceled" }).eq("id", order.id);

        const { data: aforo } = await db
          .from("section_availability").select("free_tables").eq("section_id", section.id).maybeSingle();

        return fail(
          aforo?.free_tables ? `Solo quedan ${aforo.free_tables} mesa(s) en ${section.label}` : "La sección está agotada",
          409,
          { sold_out: true, remaining_tables: aforo?.free_tables ?? 0 },
        );
      }

      await db.from("order_tables").insert(
        asignadas.map((m: any) => ({
          order_id: order.id,
          table_id: m.mesa_id,
          table_code: m.mesa_code,
        })),
      );

      return await cobrar(db, {
        event,
        orderId: order.id,
        sectionLabel: section.label,
        montoCents,
        personas,
        mesas: asignadas.map((m: any) => m.mesa_code),
        descripcionLugar: `${mesasNecesarias} mesa(s) · lugar por orden de llegada`,
        buyer: { nombre, apellido, documento, whatsapp, email },
        alFallar: async () => {
          await db.from("seats")
            .update({ status: "available", held_by: null, held_until: null })
            .eq("held_by", order.id);
        },
      });
    }

    // General: sin mesas ni tope.
    if (section.capacity !== null) {
      const { count } = await db
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("section_id", section.id)
        .neq("status", "canceled");

      if ((count ?? 0) + personas > section.capacity) {
        const quedan = Math.max(0, section.capacity - (count ?? 0));
        return fail(
          quedan === 0 ? "La sección está agotada" : `Solo quedan ${quedan} lugares`,
          409,
          { sold_out: true, remaining: quedan },
        );
      }
    }

    return await cobrar(db, {
      event,
      sectionId: section.id,
      sectionLabel: section.label,
      montoCents: section.price_cents * personas,
      personas,
      mesas: [],
      descripcionLugar: section.label,
      buyer: { nombre, apellido, documento, whatsapp, email },
    });
  }

  // ------------------------------------------------ con mapa: A, B, C y Única
  if (codigos.length > MAX_MESAS) return fail(`No se pueden reservar más de ${MAX_MESAS} mesas juntas`);

  const { data: mesas } = await db
    .from("tables")
    .select("id, code, seat_count, section_id, sections!inner(id, event_id, code, label, price_cents, assignment_mode)")
    .in("code", codigos);

  const delEvento = (mesas ?? []).filter((m: any) => m.sections.event_id === event.id);

  if (delEvento.length !== codigos.length) {
    return fail("Alguna de las mesas no existe en este evento", 404);
  }
  if (delEvento.some((m: any) => m.sections.assignment_mode !== "manual")) {
    return fail("Esa sección no se elige desde el plano");
  }

  const lugares = delEvento.reduce((acc: number, m: any) => acc + m.seat_count, 0);
  if (lugares < personas) {
    return fail(`Con ${delEvento.length} mesa(s) entran ${lugares} personas y son ${personas}`, 400);
  }

  // Cada mesa se cobra por sus sillas: la mesa va entera, se paga entera.
  const montoCents = delEvento.reduce(
    (acc: number, m: any) => acc + m.sections.price_cents * m.seat_count,
    0,
  );

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      event_id: event.id,
      section_id: delEvento[0].section_id,
      buyer_name: nombre,
      buyer_lastname: apellido,
      buyer_document: documento,
      buyer_whatsapp: whatsapp,
      amount_cents: montoCents,
      people: personas,
      tables_count: delEvento.length,
    })
    .select("id")
    .single();

  if (orderError || !order) return fail("No se pudo iniciar la compra", 500);

  const liberar = async () => {
    await db
      .from("seats")
      .update({ status: "available", held_by: null, held_until: null })
      .eq("held_by", order.id);
  };

  // Cada mesa se toma entera. Si una ya estaba tomada, se sueltan las anteriores.
  for (const mesa of delEvento as any[]) {
    const { data: reservadas, error: holdError } = await db.rpc("hold_table", {
      p_table_id: mesa.id,
      p_order_id: order.id,
      p_ttl_minutes: HOLD_MINUTES,
    });

    // Un fallo de la función no debe confundirse con "mesa ocupada".
    if (holdError) {
      await liberar();
      await db.from("orders").update({ status: "failed" }).eq("id", order.id);
      console.error("create-order/hold_table", holdError);
      return fail("No se pudo reservar la mesa. Intenta de nuevo.", 500);
    }

    if (!reservadas || Number(reservadas) === 0) {
      await liberar();
      await db.from("orders").update({ status: "canceled" }).eq("id", order.id);
      return fail(`La mesa ${mesa.code} acaba de ser reservada por otra persona`, 409, {
        seat_taken: true,
        table_code: mesa.code,
      });
    }
  }

  await db.from("order_tables").insert(
    (delEvento as any[]).map((m) => ({
      order_id: order.id,
      table_id: m.id,
      table_code: m.code,
    })),
  );

  const nombresMesas = (delEvento as any[]).map((m) => m.code).join(", ");

  return await cobrar(db, {
    event,
    orderId: order.id,
    sectionLabel: (delEvento as any[])[0].sections.label,
    montoCents,
    personas,
    mesas: (delEvento as any[]).map((m) => m.code),
    descripcionLugar: `Mesa ${nombresMesas}`,
    buyer: { nombre, apellido, documento, whatsapp, email },
    alFallar: async () => {
      await liberar();
    },
  });
});

// ---------------------------------------------------------------- cobro

type CobroParams = {
  event: { id: string; name: string };
  orderId?: string;
  sectionId?: string;
  sectionLabel: string;
  montoCents: number;
  personas: number;
  mesas: string[];
  descripcionLugar: string;
  buyer: { nombre: string; apellido: string; documento: string; whatsapp: string; email: string };
  alFallar?: () => Promise<void>;
};

async function cobrar(db: any, p: CobroParams): Promise<Response> {
  let orderId = p.orderId;

  if (!orderId) {
    const { data: order, error } = await db
      .from("orders")
      .insert({
        event_id: p.event.id,
        section_id: p.sectionId,
        buyer_name: p.buyer.nombre,
        buyer_lastname: p.buyer.apellido,
        buyer_document: p.buyer.documento,
        buyer_whatsapp: p.buyer.whatsapp,
        amount_cents: p.montoCents,
        people: p.personas,
        tables_count: 0,
      })
      .select("id")
      .single();

    if (error || !order) return fail("No se pudo iniciar la compra", 500);
    orderId = order.id;
  }

  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString();

  let pix;
  try {
    /* Asaas no recibe la URL del webhook por cobranza: se configura una vez
       para toda la cuenta. Y tampoco recibe un vencimiento en minutos —el QR
       vive hasta el fin del día—, así que la ventana real de pago la marca la
       reserva de la mesa, y `expire-holds` cancela la cobranza al soltarla. */
    pix = await crearCobroPix({
      orderId: orderId!,
      amountCents: p.montoCents,
      description: `${p.event.name} · ${p.sectionLabel} · ${p.descripcionLugar}`,
      buyer: {
        nombre: p.buyer.nombre,
        apellido: p.buyer.apellido,
        whatsapp: p.buyer.whatsapp,
        email: p.buyer.email,
      },
    });
  } catch (error) {
    if (p.alFallar) await p.alFallar();
    await db.from("orders").update({ status: "failed" }).eq("id", orderId);
    // El detalle de la pasarela queda en los logs de la función, no en la
    // respuesta: al comprador no le sirve y expone cómo está armado el cobro.
    console.error("create-order/asaas", error);
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
    .eq("id", orderId);

  return json({
    order_id: orderId,
    amount_cents: p.montoCents,
    people: p.personas,
    tables: p.mesas,
    section_label: p.sectionLabel,
    pix_qr_code: pix.qrCode,
    pix_qr_base64: pix.qrCodeBase64,
    expires_at: expiresAt,
  });
}
