import { requireStaff, serviceClient } from "../_shared/supabase.ts";
import { verifySignature } from "../_shared/tickets.ts";
import { fail, json, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();

  /* ------------------------------------------------------------
     1. CONSULTA PÚBLICA POR CÉDULA: El comprador busca sus entradas
     ------------------------------------------------------------ */
  if (body.action === "consultar_por_cedula" || body.action === "consultar_por_documento") {
    const docBruto = String(body.documento ?? body.cpf ?? body.cedula ?? "").trim();
    if (!docBruto || docBruto.length < 3) {
      return fail("Ingresa un número de cédula o CPF válido");
    }

    const docDigitos = docBruto.replace(/\D/g, "");
    const docAlfanum = docBruto.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    // Filtros de coincidencia flexible
    const patrones = new Set<string>();
    patrones.add(`%${docBruto}%`);
    if (docDigitos.length >= 3) patrones.add(`%${docDigitos}%`);
    if (docAlfanum.length >= 3) patrones.add(`%${docAlfanum}%`);

    // Si es un CPF de 11 dígitos, probar con formato brasileño estándar 000.000.000-00
    if (docDigitos.length === 11) {
      const cpfFormateado = `${docDigitos.slice(0, 3)}.${docDigitos.slice(3, 6)}.${docDigitos.slice(6, 9)}-${docDigitos.slice(9, 11)}`;
      patrones.add(`%${cpfFormateado}%`);
    }

    const orClauses = Array.from(patrones)
      .map((p) => `buyer_document.ilike.${p}`)
      .join(",");

    const { data: tickets, error } = await db
      .from("tickets")
      .select(`
        id, code, qr_signature, section_label, table_code, guest_index,
        buyer_name, buyer_lastname, buyer_document, status, created_at,
        events ( name, event_date, venue )
      `)
      .or(orClauses)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("verify-ticket/consulta_error:", error);
      return fail("No se pudieron consultar las entradas", 500);
    }

    const resultado = (tickets ?? []).map((t: any) => ({
      code: t.code,
      qr_signature: t.qr_signature,
      section_label: t.section_label,
      table_code: t.table_code,
      guest_index: t.guest_index,
      buyer_name: t.buyer_name,
      buyer_lastname: t.buyer_lastname,
      buyer_document: t.buyer_document,
      status: t.status,
      event_name: t.events?.name ?? "Pro Kart Evento",
      event_date: t.events?.event_date ?? null,
      event_venue: t.events?.venue ?? null,
      created_at: t.created_at,
    }));

    return json({ ok: true, tickets: resultado });
  }

  /* ------------------------------------------------------------
     2. CONSULTA PÚBLICA DE TICKET INDIVIDUAL POR CÓDIGO + FIRMA
     ------------------------------------------------------------ */
  if (body.action === "consultar_ticket") {
    const code = String(body.code ?? "").trim().toUpperCase();
    const signature = String(body.signature ?? "").trim().toLowerCase();
    if (!code || !signature) return fail("Falta el código o la firma de la entrada");

    const valid = await verifySignature(code, signature);
    if (!valid) return fail("Firma de seguridad inválida", 403);

    const { data: t } = await db
      .from("tickets")
      .select("id, code, qr_signature, section_label, table_code, guest_index, buyer_name, buyer_lastname, buyer_document, status, events(name, event_date, venue)")
      .eq("code", code)
      .maybeSingle();

    if (!t) return fail("Entrada no encontrada", 404);

    return json({
      ok: true,
      ticket: {
        code: t.code,
        qr_signature: t.qr_signature,
        section_label: t.section_label,
        table_code: t.table_code,
        guest_index: t.guest_index,
        buyer_name: t.buyer_name,
        buyer_lastname: t.buyer_lastname,
        buyer_document: t.buyer_document,
        status: t.status,
        event_name: (t as any).events?.name ?? "Pro Kart",
        event_date: (t as any).events?.event_date ?? null,
        event_venue: (t as any).events?.venue ?? null,
      },
    });
  }

  /* ------------------------------------------------------------
     3. VALIDACIÓN EN PUERTA: Requiere autenticación de staff
     ------------------------------------------------------------ */
  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión como personal del evento", 401);

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return fail("Falta el código de la entrada");

  // Si vino de un QR escaneado, la firma debe coincidir. Tecleado a mano no hay
  // firma que validar: la sesión de staff es la autorización.
  if (body.signature) {
    const valid = await verifySignature(code, body.signature.trim().toLowerCase());
    if (!valid) return fail("El código QR fue alterado", 403, { tampered: true });
  }

  // El cliente de servicio ya se creó arriba. Declararlo otra vez acá era un
  // SyntaxError: la función no arrancaba y la puerta, «Mis entradas» y la
  // consulta por QR respondían 503 (BOOT_ERROR).
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
