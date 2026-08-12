import { serviceClient } from "../_shared/supabase.ts";
import { fail, json } from "../_shared/http.ts";

// Respaldo para cuando pg_cron no está disponible: se agenda desde el panel
// (Edge Functions > Cron). Protegida con un secreto propio porque no lleva JWT.
Deno.serve(async (req) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return fail("No autorizado", 401);
  }

  const { data, error } = await serviceClient().rpc("expire_pending_holds");
  if (error) return fail(error.message, 500);

  return json({ released_seats: data ?? 0 });
});
