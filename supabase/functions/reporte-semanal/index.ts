import { serviceClient } from "../_shared/supabase.ts";
import { recibidoNetoCents } from "../_shared/asaas.ts";
import { llamadaDeCronValida } from "../_shared/cron.ts";
import { enviarReporte } from "../_shared/telegram.ts";
import {
  armarMensajeReporte,
  diasParaExtracto,
  fechaLocalISO,
  rangoSemana,
  type Totales,
} from "../_shared/reporte.ts";
import { fail, json } from "../_shared/http.ts";

/* El reporte de los lunes.
 *
 * Cuatro números, dos veces: la semana que cerró y el acumulado del evento.
 * Entradas, cortesías y facturado salen de nuestra base. Lo recibido sale del
 * extracto de Asaas y no de una resta nuestra, porque es el número que la
 * administración va a comparar contra el banco: si lo calculáramos restando
 * una comisión supuesta, cualquier tarifa nueva de Asaas nos dejaría
 * informando de más sin que nadie se entere.
 *
 * Protegida con el mismo secreto que `expire-holds`: no lleva JWT porque la
 * llama el cron, no una persona. */

async function totalesDe(
  db: any,
  eventId: string,
  desde?: Date,
  hasta?: Date,
): Promise<Omit<Totales, "recibidoCents">> {
  let consulta = db
    .from("orders")
    .select("amount_cents, is_courtesy, tickets(id, status)")
    .eq("event_id", eventId)
    .eq("status", "paid");

  // El corte va por `paid_at`: lo que importa es cuándo entró la plata, no
  // cuándo se empezó la compra.
  if (desde) consulta = consulta.gte("paid_at", desde.toISOString());
  if (hasta) consulta = consulta.lt("paid_at", hasta.toISOString());

  const { data, error } = await consulta;
  if (error) throw new Error(`No se pudieron leer las compras: ${error.message}`);

  let entradas = 0;
  let cortesias = 0;
  let pagadoCents = 0;

  for (const orden of data ?? []) {
    // Una entrada anulada no se vendió: contarla infla el número que se usa
    // para saber cuánta gente entra al salón.
    const vivas = (orden.tickets ?? []).filter((t: any) => t.status !== "canceled").length;

    if (orden.is_courtesy) {
      cortesias += vivas;
    } else {
      entradas += vivas;
      pagadoCents += orden.amount_cents ?? 0;
    }
  }

  return { entradas, cortesias, pagadoCents };
}

Deno.serve(async (req) => {
  const db = serviceClient();
  if (!await llamadaDeCronValida(req, db)) return fail("No autorizado", 401);

  const { data: event } = await db
    .from("events")
    .select("id, name")
    .eq("status", "published")
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!event) return json({ ok: true, ignored: "no hay evento publicado" });

  const { desde, hasta } = rangoSemana(new Date());

  const [semanaBase, acumuladoBase] = await Promise.all([
    totalesDe(db, event.id, desde, hasta),
    totalesDe(db, event.id),
  ]);

  // ---------------------------------------------------------- lo recibido
  const diasSemana = diasParaExtracto(desde, hasta);
  const recibidoSemana = await recibidoNetoCents(diasSemana.desde, diasSemana.hasta);

  /* Para el acumulado el extracto se pide desde el primer cobro que entró.
     Arrancar en una fecha fija arbitraria haría paginar de más cada semana. */
  const { data: primera } = await db
    .from("orders")
    .select("paid_at")
    .eq("event_id", event.id)
    .eq("status", "paid")
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const recibidoAcumulado = primera?.paid_at
    ? await recibidoNetoCents(fechaLocalISO(new Date(primera.paid_at)), diasSemana.hasta)
    : 0;

  const texto = armarMensajeReporte({
    eventoNombre: event.name,
    desde,
    hasta,
    semana: { ...semanaBase, recibidoCents: recibidoSemana },
    acumulado: { ...acumuladoBase, recibidoCents: recibidoAcumulado },
  });

  await enviarReporte(texto);

  return json({
    ok: true,
    periodo: { desde: desde.toISOString(), hasta: hasta.toISOString() },
    semana: { ...semanaBase, recibidoCents: recibidoSemana },
    acumulado: { ...acumuladoBase, recibidoCents: recibidoAcumulado },
  });
});
