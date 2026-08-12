import { requireStaff, serviceClient } from "../_shared/supabase.ts";
import { generateTicketCode, signTicket } from "../_shared/tickets.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Entradas de cortesía: reservas sin cobro autorizadas por un administrador.

   El PIN de 3 dígitos no es la autenticación —hace falta sesión con rol admin
   antes de llegar acá— sino una confirmación de que quien está frente a la
   pantalla es realmente el administrador y no alguien con su sesión abierta.
   Por eso se compara del lado del servidor y nunca se envía al navegador. */

type HeldSeat = { id: string; table_id: string; number: number };

function seatOrNull(raw: unknown): HeldSeat | null {
  const fila = Array.isArray(raw) ? raw[0] : raw;
  if (!fila || typeof fila !== "object") return null;
  const seat = fila as Partial<HeldSeat>;
  return seat.id ? (seat as HeldSeat) : null;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);
  if (staff.role !== "admin") return fail("Solo un administrador puede emitir cortesías", 403);

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

  const nombre = String(body.nombre ?? "").trim().slice(0, 120);
  const apellido = String(body.apellido ?? "").trim().slice(0, 120);
  const documento = String(body.documento ?? "").trim().slice(0, 40);
  const whatsapp = String(body.whatsapp ?? "").trim().slice(0, 40);
  const motivo = String(body.reason ?? "").trim().slice(0, 200);

  if (!nombre || !apellido) return fail("Falta el nombre del invitado");
  if (!body.event_slug || !body.section_code) return fail("Falta el evento o la sección");

  const { data: event } = await db
    .from("events").select("id, name").eq("slug", body.event_slug).maybeSingle();
  if (!event) return fail("Evento inexistente", 404);

  const { data: section } = await db
    .from("sections")
    .select("id, code, label, assignment_mode")
    .eq("event_id", event.id)
    .eq("code", body.section_code)
    .maybeSingle();
  if (!section) return fail("Sección inexistente", 404);

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      event_id: event.id,
      section_id: section.id,
      buyer_name: nombre,
      buyer_lastname: apellido,
      buyer_document: documento || "CORTESIA",
      buyer_whatsapp: whatsapp || "-",
      amount_cents: 0,
      status: "paid",
      is_courtesy: true,
    })
    .select("id")
    .single();

  if (orderError || !order) return fail("No se pudo registrar la cortesía", 500);

  let heldSeat: HeldSeat | null = null;

  if (section.assignment_mode === "manual") {
    if (!body.table_number || !body.seat_number) {
      await db.from("orders").delete().eq("id", order.id);
      return fail("Elegí mesa y silla");
    }

    const { data: table } = await db
      .from("tables").select("id").eq("section_id", section.id)
      .eq("number", body.table_number).maybeSingle();
    if (!table) {
      await db.from("orders").delete().eq("id", order.id);
      return fail("La mesa no existe", 404);
    }

    const { data: seat } = await db
      .from("seats").select("id").eq("table_id", table.id)
      .eq("number", body.seat_number).maybeSingle();
    if (!seat) {
      await db.from("orders").delete().eq("id", order.id);
      return fail("La silla no existe", 404);
    }

    const { data: held } = await db.rpc("hold_seat_manual", {
      p_seat_id: seat.id,
      p_order_id: order.id,
      p_ttl_minutes: 60,
    });
    heldSeat = seatOrNull(held);
    if (!heldSeat) {
      await db.from("orders").delete().eq("id", order.id);
      return fail("Esa silla ya está tomada", 409, { seat_taken: true });
    }
  } else if (section.assignment_mode === "auto_fcfs") {
    const { data: held } = await db.rpc("hold_seat_auto_fcfs", {
      p_section_id: section.id,
      p_order_id: order.id,
      p_ttl_minutes: 60,
    });
    heldSeat = seatOrNull(held);
    if (!heldSeat) {
      await db.from("orders").delete().eq("id", order.id);
      return fail("La sección está agotada", 409, { sold_out: true });
    }
  }

  let tableNumber: number | null = null;
  if (heldSeat) {
    const { data: table } = await db
      .from("tables").select("number").eq("id", heldSeat.table_id).maybeSingle();
    tableNumber = table?.number ?? null;
    await db.from("orders")
      .update({ table_id: heldSeat.table_id, seat_id: heldSeat.id })
      .eq("id", order.id);
  }

  const code = generateTicketCode(section.code);
  const qrSignature = await signTicket(code);

  const { data: ticket, error: ticketError } = await db
    .from("tickets")
    .insert({
      order_id: order.id,
      event_id: event.id,
      section_id: section.id,
      code,
      qr_signature: qrSignature,
      section_code: section.code,
      section_label: section.label,
      table_number: tableNumber,
      seat_number: heldSeat?.number ?? null,
      buyer_name: nombre,
      buyer_lastname: apellido,
      buyer_document: documento || "CORTESIA",
      buyer_whatsapp: whatsapp || "-",
      is_courtesy: true,
      issued_by: staff.userId,
    })
    .select("id, code, qr_signature")
    .single();

  if (ticketError || !ticket) {
    if (heldSeat) {
      await db.from("seats")
        .update({ status: "available", held_by: null, held_until: null })
        .eq("id", heldSeat.id);
    }
    await db.from("orders").delete().eq("id", order.id);
    return fail("No se pudo emitir la cortesía", 500);
  }

  if (heldSeat) {
    await db.from("seats")
      .update({ status: "occupied", held_by: null, held_until: null, ticket_id: ticket.id })
      .eq("id", heldSeat.id);
  }

  await db.from("courtesy_log").insert({
    ticket_id: ticket.id,
    issued_by: staff.userId,
    reason: motivo || null,
  });

  return json({
    issued: true,
    ticket: {
      code: ticket.code,
      qr_signature: ticket.qr_signature,
      section_label: section.label,
      table_number: tableNumber,
      seat_number: heldSeat?.number ?? null,
      buyer_name: nombre,
      buyer_lastname: apellido,
    },
  });
});
