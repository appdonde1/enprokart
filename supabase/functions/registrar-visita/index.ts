import { serviceClient } from "../_shared/supabase.ts";
import { json, preflight } from "../_shared/http.ts";
import { esRobot, hashVisitante } from "../_shared/visitante.ts";

/* Cuenta una visita y devuelve el número del día.

   Se cuenta acá y no en el navegador porque un contador del lado del cliente no
   se puede creer: sube al recargar y cualquiera lo mueve desde la consola. La
   identidad sale de la IP y el navegador, que el visitante no elige libremente,
   y la deduplicación la hace la clave primaria de `visits_daily`.

   Devuelve el conteo en la misma llamada para que el overlay, que muestra ese
   número en su botón de cierre, no tenga que hacer un segundo viaje. */

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;

  const db = serviceClient();

  // A los robots se les responde el número, pero no suman. Si contaran, el dato
  // que se le muestra a un anunciante sería mentira: los rastreadores entran
  // muchas más veces que las personas.
  if (esRobot(req.headers.get("user-agent") ?? "")) {
    const { data } = await db
      .from("visits_totals")
      .select("uniques, pageviews")
      .eq("day", new Date().toISOString().slice(0, 10))
      .maybeSingle();

    return json({
      visitas_hoy: data?.uniques ?? 0,
      vistas_hoy: data?.pageviews ?? 0,
      contada: false,
    });
  }

  const hash = await hashVisitante(req);

  const { data, error } = await db.rpc("registrar_visita", { p_hash: hash });

  if (error) {
    // Que falle el contador no puede romper la página: se responde en cero y el
    // overlay simplemente muestra un guion.
    console.error("registrar-visita", error);
    return json({ visitas_hoy: null, vistas_hoy: null, contada: false });
  }

  const fila = Array.isArray(data) ? data[0] : data;

  return json({
    visitas_hoy: fila?.visitas_hoy ?? 0,
    vistas_hoy: fila?.vistas_hoy ?? 0,
    contada: true,
  });
});
