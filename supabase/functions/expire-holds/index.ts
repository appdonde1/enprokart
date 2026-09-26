import { serviceClient } from "../_shared/supabase.ts";
import { cancelarCobro } from "../_shared/asaas.ts";
import { llamadaDeCronValida } from "../_shared/cron.ts";
import { fail, json } from "../_shared/http.ts";

/* Suelta las reservas vencidas y apaga sus cobranzas.
 *
 * Respaldo para cuando pg_cron no está disponible: se agenda desde el panel
 * (Edge Functions > Cron). Protegida con un secreto propio porque no lleva JWT.
 *
 * Lo segundo no es opcional. El QR de Asaas no vence en minutos: vive hasta
 * doce meses. Si solo soltáramos la mesa, el QR viejo seguiría cobrando y
 * alguien podría pagar una mesa que ya se revendió. Cancelar la cobranza es lo
 * que cierra esa puerta.
 */
Deno.serve(async (req) => {
  const db = serviceClient();
  if (!await llamadaDeCronValida(req, db)) return fail("No autorizado", 401);

  /* Las órdenes que están por perder su reserva se toman ANTES de liberar:
     después, `held_by` queda en null y ya no hay forma de saber cuáles eran. */
  const { data: porVencer } = await db
    .from("orders")
    .select("id, provider_payment_id")
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .not("provider_payment_id", "is", null);

  const { data: liberadas, error } = await db.rpc("expire_pending_holds");
  if (error) return fail(error.message, 500);

  let canceladas = 0;
  const fallidas: string[] = [];

  for (const o of porVencer ?? []) {
    // Si la cancelación falla, la red del webhook devuelve la plata cuando el
    // pago tardío entre. Se registra igual: es una puerta que quedó abierta.
    const ok = await cancelarCobro(o.provider_payment_id).catch(() => false);
    if (ok) canceladas++;
    else fallidas.push(o.id);
  }

  if (fallidas.length) {
    console.error("expire-holds: no se pudieron cancelar cobranzas de", fallidas);
  }

  // Las órdenes vencidas quedan marcadas: sin esto seguirían en `pending` para
  // siempre y volverían a entrar en este barrido en cada corrida.
  if (porVencer?.length) {
    await db.from("orders")
      .update({ status: "expired" })
      .in("id", porVencer.map((o) => o.id));
  }

  return json({
    released_seats: liberadas ?? 0,
    charges_canceled: canceladas,
    charges_failed: fallidas.length,
  });
});
