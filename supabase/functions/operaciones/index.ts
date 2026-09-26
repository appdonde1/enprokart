import { esAdmin, requireStaff, serviceClient } from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";
import { generateTicketCode, signTicket } from "../_shared/tickets.ts";

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

  const adminSecret = req.headers.get("x-admin-secret");
  const isCli = Boolean(adminSecret && adminSecret === Deno.env.get("ADMIN_CLI_SECRET"));

  let staff: { userId: string; role: any } | null = null;
  if (!isCli) {
    staff = await requireStaff(req);
    if (!staff) return fail("Necesitas iniciar sesión", 401);
    if (!esAdmin(staff.role)) return fail("Solo un administrador ve las operaciones", 403);
  }

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

  /* Completar mesas a su capacidad completa: P a 4 personas y Oro a 6 personas */
  if (body.action === "completar_mesas_a_4" || body.action === "completar_mesas_capacidad") {
    const slug = typeof body.event_slug === "string" ? body.event_slug : "noche-vip-fest";
    const { data: event } = await db
      .from("events")
      .select("id, slug, name")
      .eq("slug", slug)
      .maybeSingle();

    if (!event) return fail("Evento no encontrado");

    // Cargar información de las mesas del evento
    const { data: allTables } = await db
      .from("tables")
      .select("code, seat_count, section_id, sections!inner(event_id, code, label)")
      .eq("sections.event_id", event.id);

    const seatCountMap = new Map<string, number>();
    const sectionOfTable = new Map<string, { code: string; label: string }>();
    for (const t of allTables ?? []) {
      if (t.code) {
        seatCountMap.set(t.code, t.seat_count ?? (t.code.startsWith("P") ? 4 : (t.code.startsWith("U") ? 8 : 6)));
        if (t.sections) {
          sectionOfTable.set(t.code, t.sections as any);
        }
      }
    }

    const { data: orders, error: errOrd } = await db
      .from("orders")
      .select(`
        id, order_number, buyer_name, buyer_lastname, buyer_document, buyer_whatsapp, buyer_email,
        section_id, people, tables_count, status, is_courtesy, created_at,
        sections ( id, code, label ),
        order_tables ( table_id, table_code ),
        tickets ( id, code, status, table_code, guest_index )
      `)
      .eq("event_id", event.id)
      .neq("status", "canceled");

    if (errOrd) return fail("Error buscando órdenes: " + errOrd.message, 500);

    const resultados = [];

    for (const ord of orders ?? []) {
      const orderTables = (ord.order_tables ?? []).map((ot: any) => ot.table_code).filter(Boolean);
      const tickets = (ord.tickets ?? []);
      const ticketTables = tickets.map((t: any) => t.table_code).filter(Boolean);
      const codigosMesa = [...new Set([...orderTables, ...ticketTables])];

      const secCode = ord.sections?.code || "";
      const esPlata = codigosMesa.some((c: string) => c.startsWith("P")) || secCode === "PLATA";
      const esOro = codigosMesa.some((c: string) => /^[ABC]/.test(c)) || ["A", "B", "C"].includes(secCode);

      if (codigosMesa.length > 0 || esPlata || esOro) {
        // Calcular la meta exacta de personas según las mesas
        let metaPersonas = 0;
        const mesaSillas: { code: string; sillas: number; secCode: string; secLabel: string }[] = [];

        if (codigosMesa.length > 0) {
          for (const code of codigosMesa) {
            let sillas = seatCountMap.get(code);
            if (!sillas) {
              if (code.startsWith("P")) sillas = 4;
              else if (code.startsWith("U")) sillas = 8;
              else sillas = 6;
            }
            const secInfo = sectionOfTable.get(code);
            mesaSillas.push({
              code,
              sillas,
              secCode: secInfo?.code ?? (code.startsWith("P") ? "PLATA" : "A"),
              secLabel: secInfo?.label ?? (code.startsWith("P") ? "VIP Plata" : "VIP Oro"),
            });
            metaPersonas += sillas;
          }
        } else if (esPlata) {
          const count = Math.max(1, ord.tables_count || 1);
          metaPersonas = count * 4;
        } else if (esOro) {
          const count = Math.max(1, ord.tables_count || 1);
          metaPersonas = count * 6;
        }

        if (ord.people < metaPersonas || tickets.length < metaPersonas) {
          if (ord.people < metaPersonas) {
            await db
              .from("orders")
              .update({ people: metaPersonas })
              .eq("id", ord.id);
          }

          const ticketsCreados = [];
          const cantExistente = tickets.length;

          // Mapeo de cuál mesa le corresponde a cada índice
          // Arma una lista plana de códigos de mesa por cada silla disponible
          const listaMesasPorSilla: { code: string; secCode: string; secLabel: string }[] = [];
          for (const ms of mesaSillas) {
            for (let s = 0; s < ms.sillas; s++) {
              listaMesasPorSilla.push({ code: ms.code, secCode: ms.secCode, secLabel: ms.secLabel });
            }
          }

          for (let i = cantExistente; i < metaPersonas; i++) {
            const mesaAsignada = listaMesasPorSilla[i] ?? listaMesasPorSilla[listaMesasPorSilla.length - 1];
            const tCode = mesaAsignada?.code ?? codigosMesa[0] ?? null;
            const tSecCode = mesaAsignada?.secCode ?? ord.sections?.code ?? (tCode?.startsWith("P") ? "PLATA" : "A");
            const tSecLabel = mesaAsignada?.secLabel ?? ord.sections?.label ?? (tCode?.startsWith("P") ? "VIP Plata" : "VIP Oro");

            const code = generateTicketCode(tSecCode);
            const qr_signature = await signTicket(code);

            const nuevoTicket = {
              order_id: ord.id,
              event_id: event.id,
              section_id: ord.section_id,
              code,
              qr_signature,
              section_code: tSecCode,
              section_label: tSecLabel,
              table_code: tCode,
              table_number: null,
              seat_number: null,
              guest_index: i + 1,
              buyer_name: ord.buyer_name,
              buyer_lastname: ord.buyer_lastname,
              buyer_document: ord.buyer_document,
              buyer_whatsapp: ord.buyer_whatsapp,
              is_courtesy: ord.is_courtesy,
              issued_by: staff?.userId ?? null,
              status: "valid",
            };

            const { data: insTicket, error: insErr } = await db
              .from("tickets")
              .insert(nuevoTicket)
              .select("id, code, table_code, guest_index")
              .single();

            if (!insErr && insTicket) {
              ticketsCreados.push(insTicket);

              if (ord.is_courtesy) {
                await db.from("courtesy_log").insert({
                  ticket_id: insTicket.id,
                  issued_by: staff?.userId ?? null,
                  reason: `Ajuste a capacidad completa (${tSecCode}: ${metaPersonas} personas)`,
                });
              }
            } else {
              console.error("Error insertando ticket adicional:", insErr);
            }
          }

          resultados.push({
            order_id: ord.id,
            order_number: ord.order_number,
            comprador: `${ord.buyer_name} ${ord.buyer_lastname}`.trim(),
            mesas: codigosMesa,
            tipo: esOro ? "Oro (6 personas/mesa)" : "Plata (4 personas/mesa)",
            personas_anterior: ord.people,
            personas_nuevo: metaPersonas,
            tickets_agregados: ticketsCreados.length,
            codigos_tickets_nuevos: ticketsCreados.map((t: any) => t.code),
          });
        }
      }
    }

    return json({
      ok: true,
      mensaje: `Se completaron ${resultados.length} órdenes: P a 4 personas y Oro a 6 personas`,
      resultados,
    });
  }

  /* Información contextual de las mesas para el mapa de reservas */
  if (body.action === "info_mesas") {
    const eventId = typeof body.event_id === "string" ? body.event_id : null;
    if (!eventId) return fail("Falta el identificador del evento");

    // 1. Obtener órdenes activas (paid, pending)
    const { data: ordenes, error: errOrd } = await db
      .from("orders")
      .select(`
        id, order_number, buyer_name, buyer_lastname, buyer_document, buyer_whatsapp, buyer_email,
        people, tables_count, amount_cents, status, is_courtesy, created_at, paid_at,
        order_tables ( table_code ),
        tickets ( id, code, status, table_code, used_at, used_by )
      `)
      .eq("event_id", eventId)
      .neq("status", "canceled");

    if (errOrd) return fail("Error consultando órdenes", 500);

    // 2. Obtener courtesy_log para los tickets de cortesía
    const ticketIds: string[] = [];
    for (const ord of ordenes ?? []) {
      if (ord.is_courtesy) {
        for (const t of (ord as any).tickets ?? []) {
          if (t.id) ticketIds.push(t.id);
        }
      }
    }

    const razonesMap = new Map<string, string>();
    if (ticketIds.length) {
      const { data: logs } = await db
        .from("courtesy_log")
        .select("ticket_id, reason")
        .in("ticket_id", ticketIds);

      for (const l of logs ?? []) {
        if (l.ticket_id && l.reason) {
          razonesMap.set(l.ticket_id, l.reason);
        }
      }
    }

    // 3. Mapear por table_code
    const mesasMap: Record<string, any> = {};

    for (const ord of ordenes ?? []) {
      const comprador = `${ord.buyer_name || ""} ${ord.buyer_lastname || ""}`.trim() || "Invitado / Comprador";
      const ordenTables = (ord.order_tables ?? []).map((ot: any) => ot.table_code).filter(Boolean);
      const tickets = (ord.tickets ?? []);
      const ticketTables = tickets.map((t: any) => t.table_code).filter(Boolean);
      const todosCodigos = new Set([...ordenTables, ...ticketTables]);

      let motivo = "";
      for (const t of tickets) {
        if (razonesMap.has(t.id)) {
          motivo = razonesMap.get(t.id)!;
          break;
        }
      }

      let descripcion = "";
      if (ord.is_courtesy) {
        descripcion = motivo ? `Cortesía: ${motivo}` : "Cortesía de la casa";
      } else if (ord.status === "paid") {
        descripcion = `Compra confirmada · Orden #${ord.order_number}`;
      } else {
        descripcion = `En proceso de pago · Orden #${ord.order_number}`;
      }

      const entradasUsadas = tickets.filter((t: any) => t.status === "used").length;

      for (const tableCode of todosCodigos) {
        mesasMap[tableCode] = {
          table_code: tableCode,
          order_id: ord.id,
          order_number: ord.order_number,
          comprador,
          documento: ord.buyer_document,
          whatsapp: ord.buyer_whatsapp,
          email: ord.buyer_email,
          is_courtesy: ord.is_courtesy ?? false,
          motivo,
          descripcion,
          monto_cents: ord.amount_cents,
          estado: ord.status,
          personas: ord.people,
          total_entradas: tickets.length,
          entradas_usadas: entradasUsadas,
          fecha: ord.paid_at || ord.created_at,
        };
      }
    }

    // 4. Agregar notas personalizadas de table_notes
    const { data: notasMesas } = await db
      .from("table_notes")
      .select("table_code, notes, updated_at, updated_by")
      .eq("event_id", eventId);

    for (const nm of notasMesas ?? []) {
      if (nm.notes && nm.notes.trim()) {
        const tCode = nm.table_code;
        if (!mesasMap[tCode]) {
          mesasMap[tCode] = {
            table_code: tCode,
            comprador: "Nota asignada",
            descripcion: nm.notes,
            motivo: nm.notes,
            nota_personalizada: nm.notes,
            estado: "note",
            is_courtesy: false,
          };
        } else {
          mesasMap[tCode].descripcion = nm.notes;
          mesasMap[tCode].motivo = nm.notes;
          mesasMap[tCode].nota_personalizada = nm.notes;
        }
      }
    }

    return json({ info_mesas: mesasMap });
  }

  /* Guardar / editar descripción o nota personalizada de una mesa */
  if (body.action === "guardar_nota_mesa") {
    const eventId = String(body.event_id ?? "");
    const tableCode = String(body.table_code ?? "").trim().toUpperCase();
    const notes = String(body.notes ?? "").trim();

    if (!eventId || !tableCode) return fail("Falta el evento y código de mesa");

    // 1. Guardar en table_notes
    const { error: errNote } = await db
      .from("table_notes")
      .upsert({
        event_id: eventId,
        table_code: tableCode,
        notes,
        updated_by: staff.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "event_id,table_code" });

    if (errNote) {
      console.error("error guardar_nota_mesa:", errNote);
      return fail("No se pudo guardar la nota", 500);
    }

    // 2. Si hay órdenes asociadas con esa mesa, actualizar notes y courtesy_log
    const { data: ordenes } = await db
      .from("orders")
      .select("id, is_courtesy, order_tables(table_code), tickets(id, table_code)")
      .eq("event_id", eventId)
      .neq("status", "canceled");

    for (const ord of ordenes ?? []) {
      const ordenTables = (ord.order_tables ?? []).map((ot: any) => ot.table_code);
      const ticketTables = (ord.tickets ?? []).map((t: any) => t.table_code);
      if (ordenTables.includes(tableCode) || ticketTables.includes(tableCode)) {
        await db.from("orders").update({ notes }).eq("id", ord.id);
        if (ord.is_courtesy) {
          const tIds = (ord.tickets ?? []).map((t: any) => t.id).filter(Boolean);
          if (tIds.length) {
            await db.from("courtesy_log").update({ reason: notes }).in("ticket_id", tIds);
          }
        }
      }
    }

    return json({
      ok: true,
      table_code: tableCode,
      notes,
      mensaje: `Descripción de la mesa ${tableCode} actualizada con éxito.`
    });
  }

  /* Liberar una reserva completa, indiferente del dinero.
     Solo para admin y developer (garantizado por el check esAdmin al inicio).
     Libera inmediatamente todas las mesas y sillas asociadas para que vuelvan a estar
     disponibles en el plano, cancela los tickets emitidos y marca la orden como cancelada. */
  if (body.action === "liberar_reserva") {
    const orderId = String(body.order_id ?? "");
    if (!orderId) return fail("Falta el identificador de la reserva/orden");

    const { data: orden } = await db
      .from("orders")
      .select("id, order_number, status, amount_cents, is_courtesy, buyer_name, buyer_lastname")
      .eq("id", orderId)
      .maybeSingle();

    if (!orden) return fail("Esa reserva no existe", 404);

    const { data: entradas } = await db
      .from("tickets")
      .select("id")
      .eq("order_id", orderId);
    const ids = (entradas ?? []).map((t: any) => t.id);

    // 1. Liberar todas las sillas (tanto en hold como ocupadas por ticket)
    await db.from("seats")
      .update({ status: "available", held_by: null, held_until: null, ticket_id: null })
      .eq("held_by", orderId);

    if (ids.length) {
      await db.from("seats")
        .update({ status: "available", held_by: null, held_until: null, ticket_id: null })
        .in("ticket_id", ids);

      // 2. Invalidad tickets
      await db.from("tickets")
        .update({ status: "canceled" })
        .eq("order_id", orderId);

      // 3. Limpiar registro de cortesía si aplica
      await db.from("courtesy_log").delete().in("ticket_id", ids);
    }

    // 4. Marcar la orden como cancelada
    await db.from("orders")
      .update({ status: "canceled" })
      .eq("id", orderId);

    return json({
      liberada: true,
      order_id: orderId,
      order_number: orden.order_number,
      entradas_anuladas: ids.length,
      mensaje: `Reserva #${orden.order_number} (${orden.buyer_name} ${orden.buyer_lastname}) liberada con éxito. Las mesas están disponibles nuevamente.`,
    });
  }

  /* Liberar una mesa específica desde el plano o por código.
     Permite forzar la disponibilidad de una mesa en particular. */
  if (body.action === "liberar_mesa") {
    const tableCode = typeof body.table_code === "string" ? body.table_code : null;
    const eventId = typeof body.event_id === "string" ? body.event_id : null;
    const tableId = typeof body.table_id === "string" ? body.table_id : null;

    let query = db.from("tables").select("id, code, section_id, sections!inner(event_id)");
    if (tableId) {
      query = query.eq("id", tableId);
    } else if (tableCode && eventId) {
      query = query.eq("code", tableCode).eq("sections.event_id", eventId);
    } else {
      return fail("Falta especificar la mesa y el evento");
    }

    const { data: mesas, error: errMesa } = await query;
    if (errMesa || !mesas || !mesas.length) return fail("Mesa no encontrada", 404);

    const mesa = mesas[0];

    // Buscar sillas de esta mesa
    const { data: sillas } = await db
      .from("seats")
      .select("id, held_by, ticket_id")
      .eq("table_id", mesa.id);

    const heldOrderIds = new Set<string>();
    const ticketIds: string[] = [];

    for (const s of sillas ?? []) {
      if (s.held_by) heldOrderIds.add(s.held_by);
      if (s.ticket_id) ticketIds.push(s.ticket_id);
    }

    // Liberar las sillas
    await db.from("seats")
      .update({ status: "available", held_by: null, held_until: null, ticket_id: null })
      .eq("table_id", mesa.id);

    if (ticketIds.length) {
      await db.from("tickets").update({ status: "canceled" }).in("id", ticketIds);
      await db.from("courtesy_log").delete().in("ticket_id", ticketIds);
    }

    // Cancelar órdenes si ya no tienen más sillas activas
    for (const oid of heldOrderIds) {
      const { data: restantes } = await db
        .from("seats")
        .select("id")
        .eq("held_by", oid)
        .neq("status", "available");
      if (!restantes || !restantes.length) {
        await db.from("orders").update({ status: "canceled" }).eq("id", oid);
      }
    }

    return json({
      liberada: true,
      mesa: mesa.code,
      mensaje: `Mesa ${mesa.code} liberada con éxito. Ya figura disponible en el plano.`,
    });
  }

  /* Deshacer una cortesía mal emitida. */
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
