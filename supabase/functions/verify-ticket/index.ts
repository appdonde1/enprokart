import { requireStaff, serviceClient } from "../_shared/supabase.ts";
import { verifySignature } from "../_shared/tickets.ts";
import { fail, json, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión como personal del evento", 401);

  let body: { code?: string; signature?: string; peek?: boolean };
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return fail("Falta el código de la entrada");

  // Si vino de un QR escaneado, la firma debe coincidir. Tecleado a mano no hay
  // firma que validar: la sesión de staff es la autorización.
  if (body.signature) {
    const valid = await verifySignature(code, body.signature.trim().toLowerCase());
    if (!valid) return fail("El código QR fue alterado", 403, { tampered: true });
  }

  const db = serviceClient();

  const { data: ticket } = await db
    .from("tickets")
    .select(
      "id, order_id, code, section_code, section_label, table_number, seat_number, table_code, guest_index, buyer_name, buyer_lastname, buyer_document, status, used_at, used_by",
    )
    .eq("code", code)
    .maybeSingle();

  if (!ticket) return fail("Entrada inexistente", 404, { not_found: true });

  // Datos de la compra a la que pertenece esta entrada. Se leen acá, con la
  // clave de servicio, y no desde el navegador: la cédula sigue sin ser legible
  // por el panel a granel. El mesero la ve de a una, en la entrada que escaneó,
  // y cada validación queda firmada con su usuario.
  const { data: compra } = await db
    .from("orders")
    .select("order_number, people, tables_count, amount_cents, created_at, paid_at")
    .eq("id", ticket.order_id)
    .maybeSingle();

  const detalle = {
    code: ticket.code,
    section_code: ticket.section_code,
    section_label: ticket.section_label,
    table_number: ticket.table_number,
    seat_number: ticket.seat_number,
    table_code: ticket.table_code,

    buyer_name: ticket.buyer_name,
    buyer_lastname: ticket.buyer_lastname,
    buyer_document: ticket.buyer_document,

    // De qué compra viene: número corto, cuántas personas y cuándo se pagó.
    order_number: compra?.order_number ?? null,
    people: compra?.people ?? null,
    guest_index: ticket.guest_index,
    amount_cents: compra?.amount_cents ?? null,
    purchased_at: compra?.created_at ?? null,
    paid_at: compra?.paid_at ?? null,
  };

  if (ticket.status === "canceled") {
    return json({ result: "canceled", ticket: detalle }, 409);
  }

  if (ticket.status === "used") {
    let validadaPor: string | null = null;
    if (ticket.used_by) {
      const { data: quien } = await db
        .from("staff_profiles").select("display_name").eq("id", ticket.used_by).maybeSingle();
      validadaPor = quien?.display_name ?? null;
    }
    return json({
      result: "already_used",
      ticket: detalle,
      used_at: ticket.used_at,
      used_by_name: validadaPor,
    }, 409);
  }

  // `eq("status", "valid")` hace que dos validaciones simultáneas no puedan
  // consumir la misma entrada: la segunda no actualiza ninguna fila.
  if (body.peek !== true) {
    const { data: consumed } = await db
      .from("tickets")
      .update({ status: "used", used_at: new Date().toISOString(), used_by: staff.userId })
      .eq("id", ticket.id)
      .eq("status", "valid")
      .select("id")
      .maybeSingle();

    if (!consumed) {
      return json({ result: "already_used", ticket: detalle }, 409);
    }
  }

  return json({ result: "valid", ticket: detalle });
});
