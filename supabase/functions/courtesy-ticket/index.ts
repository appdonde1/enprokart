import { esAdmin, requireStaff, serviceClient } from "../_shared/supabase.ts";
import { generateTicketCode, signTicket } from "../_shared/tickets.ts";
import { notificarTelegram } from "../_shared/telegram.ts";
import { enviarEntradasPorCorreo } from "../_shared/email.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Cortesías: reservas sin cobro autorizadas por un administrador.

   Reservan igual que una compra real —mesas enteras, una entrada por invitado—
   porque una cortesía ocupa el mismo lugar físico que alguien que pagó. La
   diferencia es el monto en cero y que queda registrada en `courtesy_log` con
   quién la emitió y por qué.

   El PIN de 3 dígitos no es la autenticación (hace falta sesión con rol admin
   antes de llegar acá) sino la confirmación de que quien está frente a la
   pantalla es el administrador y no alguien con su sesión abierta. Por eso se
   compara del lado del servidor y nunca se envía al navegador. */

const MAX_MESAS = 8;
const MAX_PERSONAS = 60;

function limpio(valor: unknown, max = 120): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

/* Reparte a los invitados entre las mesas compradas, en orden.
   Es el mismo criterio que usa el webhook para una compra pagada: la entrada
   número 5 de un grupo de 8 en dos mesas cae en la segunda. */
function mesaDelInvitado(indice: number, personas: number, mesas: string[]): string | null {
  if (!mesas.length) return null;
  const porMesa = Math.ceil(personas / mesas.length);
  return mesas[Math.min(mesas.length - 1, Math.floor(indice / porMesa))];
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);
  if (!esAdmin(staff.role)) return fail("Solo un administrador puede emitir cortesías", 403);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();

  const { data: perfil } = await db
    .from("staff_profiles").select("admin_code").eq("id", staff.userId).maybeSingle();

  if (!perfil?.admin_code) return fail("Tu cuenta no tiene código de administrador", 403);
  if (String(body.admin_code ?? "").trim() !== perfil.admin_code) {
    return fail("Código de administrador incorrecto", 403, { bad_code: true });
  }

  const nombre = limpio(body.nombre);
  const apellido = limpio(body.apellido);
  /* Vacío es vacío. Antes acá iban 'CORTESIA' y '-' porque la base exigía los
     dos campos; ahora no los exige, y un dato inventado es peor que ninguno:
     se imprime en la entrada y se puede buscar en Operaciones como si fuera
     cierto. A un invitado de la casa no se le pide la cédula. */
  const documento = limpio(body.documento, 40) || null;
  const whatsapp = limpio(body.whatsapp, 40) || null;
  const correoBruto = limpio(body.email, 120);
  const email = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(correoBruto) ? correoBruto : null;
  const motivo = limpio(body.reason, 200);

  if (!nombre || !apellido) return fail("Falta el nombre del invitado");
  if (!body.event_slug) return fail("Falta el evento");

  let personas = Math.floor(Number(body.people ?? 1));
  if (!Number.isFinite(personas) || personas < 1 || personas > MAX_PERSONAS) {
    return fail("Indica cuántas personas son");
  }

  const { data: event } = await db
    .from("events").select("id, name").eq("slug", body.event_slug).maybeSingle();
  if (!event) return fail("Evento inexistente", 404);

  const codigos = Array.isArray(body.table_codes)
    ? [...new Set(body.table_codes.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean))]
    : [];

  let sectionId: string;
  let sectionCode: string;
  let sectionLabel: string;
  let mesasTomadas: { id: string; code: string }[] = [];

  // ------------------------------------------------------------ con plano
  if (codigos.length) {
    if (codigos.length > MAX_MESAS) return fail(`No se pueden reservar más de ${MAX_MESAS} mesas juntas`);

    const { data: mesas } = await db
      .from("tables")
      .select("id, code, seat_count, section_id, sections!inner(id, event_id, code, label, assignment_mode)")
      .in("code", codigos);

    const delEvento = (mesas ?? []).filter((m: any) => m.sections.event_id === event.id);
    if (delEvento.length !== codigos.length) {
      return fail("Alguna de las mesas no existe en este evento", 404);
    }
    if (delEvento.some((m: any) => m.sections.assignment_mode !== "manual")) {
      return fail("Esa sección no se elige desde el plano");
    }

    const lugares = delEvento.reduce((a: number, m: any) => a + m.seat_count, 0);
    // Solo mesas completas: se emiten todas las sillas de las mesas reservadas
    personas = lugares;

    sectionId = (delEvento[0] as any).section_id;
    sectionCode = (delEvento[0] as any).sections.code;
    sectionLabel = (delEvento[0] as any).sections.label;
    mesasTomadas = (delEvento as any[]).map((m) => ({ id: m.id, code: m.code }));
  } else {
    // ---------------------------------------------------------- sin plano
    const codigoSeccion = limpio(body.section_code, 20).toUpperCase();
    if (!codigoSeccion) return fail("Elige una mesa en el plano o una sección");

    const { data: section } = await db
      .from("sections")
      .select("id, code, label, assignment_mode")
      .eq("event_id", event.id).eq("code", codigoSeccion).maybeSingle();

    if (!section) return fail("Sección inexistente", 404);
    if (section.assignment_mode === "manual") {
      return fail("En esta sección hay que elegir la mesa en el plano");
    }

    sectionId = section.id;
    sectionCode = section.code;
    sectionLabel = section.label;
  }

  // ------------------------------------------------------------ la orden
  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      event_id: event.id,
      section_id: sectionId,
      buyer_name: nombre,
      buyer_lastname: apellido,
      buyer_document: documento,
      buyer_whatsapp: whatsapp,
      buyer_email: email,
      amount_cents: 0,
      people: personas,
      tables_count: mesasTomadas.length,
      status: "paid",
      paid_at: new Date().toISOString(),
      is_courtesy: true,
    })
    .select("id, order_number")
    .single();

  if (orderError || !order) {
    console.error("courtesy-ticket/orden", orderError);
    return fail("No se pudo registrar la cortesía", 500);
  }

  const liberar = async () => {
    await db.from("seats")
      .update({ status: "available", held_by: null, held_until: null })
      .eq("held_by", order.id);
  };

  const deshacer = async (mensaje: string, status = 500, extra = {}) => {
    await liberar();
    await db.from("orders").delete().eq("id", order.id);
    return fail(mensaje, status, extra);
  };

  // ------------------------------------------------------------ las mesas
  if (mesasTomadas.length) {
    for (const mesa of mesasTomadas) {
      const { data: reservadas, error: holdError } = await db.rpc("hold_table", {
        p_table_id: mesa.id,
        p_order_id: order.id,
        p_ttl_minutes: 60,
      });

      if (holdError) {
        console.error("courtesy-ticket/hold_table", holdError);
        return await deshacer("No se pudo reservar la mesa. Intentá de nuevo.");
      }
      if (!reservadas || Number(reservadas) === 0) {
        return await deshacer(`La mesa ${mesa.code} ya está tomada`, 409, {
          seat_taken: true,
          table_code: mesa.code,
        });
      }
    }
  } else {
    // Plata reserva mesas enteras aunque no se elijan del plano.
    const { data: section } = await db
      .from("sections").select("assignment_mode").eq("id", sectionId).maybeSingle();

    if (section?.assignment_mode === "auto_fcfs") {
      const { data: muestra } = await db
        .from("tables").select("seat_count").eq("section_id", sectionId).limit(1).maybeSingle();

      const porMesa = muestra?.seat_count ?? 4;
      const necesarias = Math.ceil(personas / porMesa);

      const { data: tomadas, error: holdError } = await db.rpc("hold_next_tables", {
        p_section_id: sectionId,
        p_order_id: order.id,
        p_cantidad: necesarias,
        p_ttl_minutes: 60,
      });

      if (holdError) {
        console.error("courtesy-ticket/hold_next_tables", holdError);
        return await deshacer("No se pudo reservar la mesa. Intentá de nuevo.");
      }

      const asignadas = Array.isArray(tomadas) ? tomadas : [];
      if (asignadas.length < necesarias) {
        return await deshacer("No quedan mesas libres en esa sección", 409, { sold_out: true });
      }

      mesasTomadas = asignadas.map((m: any) => ({ id: m.mesa_id, code: m.mesa_code }));
      await db.from("orders").update({ tables_count: mesasTomadas.length }).eq("id", order.id);
    }
  }

  if (mesasTomadas.length) {
    await db.from("order_tables").insert(
      mesasTomadas.map((m) => ({ order_id: order.id, table_id: m.id, table_code: m.code })),
    );
  }

  // ------------------------------------------------------------ las entradas
  const codigosMesa = mesasTomadas.map((m) => m.code).sort();
  const entradas = [];

  for (let i = 0; i < personas; i++) {
    const code = generateTicketCode(sectionCode);
    entradas.push({
      order_id: order.id,
      event_id: event.id,
      section_id: sectionId,
      code,
      qr_signature: await signTicket(code),
      section_code: sectionCode,
      section_label: sectionLabel,
      table_code: mesaDelInvitado(i, personas, codigosMesa),
      table_number: null,
      seat_number: null,
      guest_index: i + 1,
      buyer_name: nombre,
      buyer_lastname: apellido,
      buyer_document: documento,
      buyer_whatsapp: whatsapp,
      is_courtesy: true,
      issued_by: staff.userId,
    });
  }

  const { data: emitidas, error: ticketError } = await db
    .from("tickets").insert(entradas).select("id, code, qr_signature, guest_index, table_code");

  if (ticketError || !emitidas?.length) {
    console.error("courtesy-ticket/emision", ticketError);
    return await deshacer("No se pudieron emitir las cortesías");
  }

  // Las mesas quedan ocupadas: una cortesía no vence como una compra sin pagar.
  if (mesasTomadas.length) {
    await db.from("seats")
      .update({ status: "occupied", held_by: null, held_until: null, ticket_id: emitidas[0].id })
      .eq("held_by", order.id);
  }

  await db.from("courtesy_log").insert(
    emitidas.map((t: any) => ({
      ticket_id: t.id,
      issued_by: staff.userId,
      reason: motivo || null,
    })),
  );

  const fechaFormateada = event?.event_date
    ? new Date(event.event_date).toLocaleDateString("es", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  // Notificar por Telegram a los 3 IDs configurados
  await notificarTelegram({
    orderNumber: order.order_number,
    buyerName: `${nombre} ${apellido}`.trim(),
    buyerDocument: documento,
    buyerWhatsapp: whatsapp,
    buyerEmail: email,
    sectionLabel,
    tables: codigosMesa.length ? codigosMesa.join(", ") : null,
    people: personas,
    amountCents: 0,
    isCourtesy: true,
    reason: motivo || null,
    ticketsCount: emitidas.length,
  }).catch((e) => console.error("courtesy-ticket/telegram_error:", e));

  // Enviar por correo si se especificó email
  if (email) {
    const entradasEmail = emitidas.map((t: any) => ({
      code: t.code,
      qrSignature: t.qr_signature,
      tableCode: t.table_code,
      guestIndex: t.guest_index,
    }));

    await enviarEntradasPorCorreo({
      destinatario: email,
      nombreComprador: `${nombre} ${apellido}`.trim(),
      documento,
      orderNumber: order.order_number,
      eventoNombre: event.name,
      eventoFecha: fechaFormateada,
      seccionNombre: sectionLabel,
      mesas: codigosMesa.length ? codigosMesa.join(", ") : null,
      entradas: entradasEmail,
    }).catch((e) => console.error("courtesy-ticket/email_error:", e));
  }

  return json({
    issued: true,
    order_number: order.order_number,
    section_label: sectionLabel,
    tables: codigosMesa,
    buyer_name: nombre,
    buyer_lastname: apellido,
    tickets: emitidas.map((t: any) => ({
      code: t.code,
      qr_signature: t.qr_signature,
      guest_index: t.guest_index,
      table_code: t.table_code,
    })),
    // Se mantiene `ticket` en singular para no romper a quien ya lo consumía.
    ticket: {
      code: emitidas[0].code,
      qr_signature: emitidas[0].qr_signature,
      section_label: sectionLabel,
      buyer_name: nombre,
      buyer_lastname: apellido,
    },
  });
});
