import { esAdmin, requireStaff, serviceClient } from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* La tabla de operaciones: qué se vendió, a quién y quién lo validó.

   Va por Edge Function y no leyendo tablas desde el navegador por una razón
   concreta: la cédula del comprador no es legible desde el panel a granel
   (`20260812000009_quitar_security_definer.sql` le quitó ese permiso a todos
   los roles, incluido admin). Acá se lee con la clave de servicio y solo
   después de confirmar que quien pregunta es admin. La auditoría necesita el
   dato; el navegador no necesita la llave. */

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);
  if (!esAdmin(staff.role)) return fail("Solo un administrador ve las operaciones", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();

  // Todos los eventos, abiertos y cerrados: una auditoría sirve justamente para
  // mirar hacia atrás.
  if (body.action === "eventos") {
    const { data } = await db
      .from("events")
      .select("id, slug, name, event_date, status")
      .order("event_date", { ascending: false });
    return json({ eventos: data ?? [] });
  }

  /* Deshacer una cortesía mal emitida.

     Se limita a cortesías a propósito: una compra pagada no se borra desde un
     panel, se reembolsa. Si esto aceptara cualquier orden, un error de dedo
     haría desaparecer el rastro de dinero que entró. */
  if (body.action === "anular_cortesia") {
    const orderId = String(body.order_id ?? "");
    if (!orderId) return fail("Falta la compra");

    const { data: orden } = await db
      .from("orders").select("id, is_courtesy, amount_cents").eq("id", orderId).maybeSingle();

    if (!orden) return fail("Esa compra no existe", 404);
    if (!orden.is_courtesy || orden.amount_cents !== 0) {
      return fail("Solo se pueden anular cortesías, no compras pagadas", 403);
    }

    const { data: entradas } = await db
      .from("tickets").select("id").eq("order_id", orderId);
    const ids = (entradas ?? []).map((t: any) => t.id);

    // Las sillas se sueltan por dos vías porque quedan en dos estados distintos:
    // `held_by` mientras la cortesía se estaba armando, y `ticket_id` una vez
    // emitida, cuando pasaron a ocupadas y `held_by` volvió a nulo.
    await db.from("seats")
      .update({ status: "available", held_by: null, held_until: null, ticket_id: null })
      .eq("held_by", orderId);

    if (ids.length) {
      await db.from("seats")
        .update({ status: "available", held_by: null, held_until: null, ticket_id: null })
        .in("ticket_id", ids);
      await db.from("courtesy_log").delete().in("ticket_id", ids);
    }

    await db.from("tickets").delete().eq("order_id", orderId);
    await db.from("order_tables").delete().eq("order_id", orderId);
    await db.from("orders").delete().eq("id", orderId);

    return json({ anulada: true, entradas_anuladas: ids.length });
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : null;
  const estado = typeof body.status === "string" ? body.status : "";

  let consulta = db
    .from("orders")
    .select(`
      id, order_number, buyer_name, buyer_lastname, buyer_document,
      people, tables_count, amount_cents, status, is_courtesy,
      created_at, paid_at,
      sections ( code, label ),
      tickets ( id, code, status, used_at, used_by, guest_index, table_code ),
      order_tables ( table_code )
    `)
    .order("created_at", { ascending: false })
    .limit(500);

  if (eventId) consulta = consulta.eq("event_id", eventId);
  if (estado) consulta = consulta.eq("status", estado);

  const { data: ordenes, error } = await consulta;
  if (error) {
    console.error("operaciones/list", error);
    return fail("No se pudieron leer las operaciones", 500);
  }

  // Quién validó: `tickets.used_by` apunta a auth.users, que no tiene relación
  // declarada con staff_profiles, así que el nombre se resuelve acá.
  const validadores = new Set<string>();
  for (const o of ordenes ?? []) {
    for (const t of (o as any).tickets ?? []) if (t.used_by) validadores.add(t.used_by);
  }

  const nombres = new Map<string, string>();
  if (validadores.size) {
    const { data: perfiles } = await db
      .from("staff_profiles")
      .select("id, display_name, email")
      .in("id", [...validadores]);
    for (const p of perfiles ?? []) nombres.set(p.id, p.display_name || p.email);
  }

  const filas = (ordenes ?? []).map((o: any) => {
    const entradas = o.tickets ?? [];
    const usadas = entradas.filter((t: any) => t.status === "used");

    return {
      order_id: o.id,
      order_number: o.order_number,
      comprador: `${o.buyer_name} ${o.buyer_lastname}`.trim(),
      documento: o.buyer_document,
      personas: o.people,
      mesas: (o.order_tables ?? []).map((m: any) => m.table_code).sort().join(", "),
      seccion: o.sections?.label ?? "—",
      monto_cents: o.amount_cents,
      estado: o.status,
      es_cortesia: o.is_courtesy ?? false,
      iniciada: o.created_at,
      pagada: o.paid_at,

      entradas_emitidas: entradas.length,
      entradas_usadas: usadas.length,

      // Quién validó cada entrada y cuándo. Es el dato que responde
      // "¿quién dejó entrar a esta persona?".
      validaciones: usadas
        .map((t: any) => ({
          code: t.code,
          invitado: t.guest_index,
          mesa: t.table_code,
          cuando: t.used_at,
          quien: t.used_by ? (nombres.get(t.used_by) ?? "desconocido") : "sin registrar",
        }))
        .sort((a: any, b: any) => String(a.cuando).localeCompare(String(b.cuando))),

      // Pagó y no recibió nada: hay que resolverlo a mano. Es el estado que
      // ningún panel debería esconder.
      sin_entregar: o.status === "paid" && entradas.length === 0,
    };
  });

  const pagadas = filas.filter((f) => f.estado === "paid");

  return json({
    operaciones: filas,
    resumen: {
      compras: filas.length,
      pagadas: pagadas.length,
      recaudado_cents: pagadas.reduce((a, f) => a + (f.monto_cents ?? 0), 0),
      entradas: pagadas.reduce((a, f) => a + f.entradas_emitidas, 0),
      validadas: pagadas.reduce((a, f) => a + f.entradas_usadas, 0),
      sin_entregar: filas.filter((f) => f.sin_entregar).length,
    },
  });
});
