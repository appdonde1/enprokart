import { requireStaff, serviceClient } from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Lo que el admin hace con una solicitud recibida.

   El currículum vive en un bucket privado y no se sirve por URL fija: se firma
   una descarga de vida corta cada vez que el admin la pide. Así el enlace que
   quede en el historial del navegador o en un chat deja de servir enseguida.

   Reiniciar una clave no está acá: eso ya lo hace `staff-admin` con la acción
   `reset_password`, y duplicar esa lógica sería tener dos formas distintas de
   generar contraseñas. El panel llama primero a esa y después marca atendida. */

const MINUTOS_DE_LA_DESCARGA = 5;

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);
  if (staff.role !== "admin") return fail("Solo un administrador ve las solicitudes", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();
  const accion = String(body.action ?? "");
  const id = String(body.id ?? "");

  if (accion === "list") {
    const kind = String(body.kind ?? "");
    let consulta = db
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (kind) consulta = consulta.eq("kind", kind);

    const { data, error } = await consulta;
    if (error) return fail("No se pudieron leer las solicitudes", 500);
    return json({ solicitudes: data ?? [] });
  }

  if (!id) return fail("Falta el id de la solicitud");

  if (accion === "cv") {
    const { data: solicitud } = await db
      .from("requests").select("cv_path").eq("id", id).maybeSingle();

    if (!solicitud?.cv_path) return fail("Esa solicitud no trae currículum", 404);

    const { data, error } = await db.storage
      .from("curriculums")
      .createSignedUrl(solicitud.cv_path, MINUTOS_DE_LA_DESCARGA * 60);

    if (error || !data?.signedUrl) {
      console.error("solicitud-accion/cv", error);
      return fail("No se pudo preparar la descarga", 500);
    }

    return json({ url: data.signedUrl, minutos: MINUTOS_DE_LA_DESCARGA });
  }

  if (accion === "atender" || accion === "reabrir") {
    const atendida = accion === "atender";
    const { error } = await db
      .from("requests")
      .update({
        status: atendida ? "atendida" : "nueva",
        handled_at: atendida ? new Date().toISOString() : null,
        handled_by: atendida ? staff.userId : null,
        notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : undefined,
      })
      .eq("id", id);

    if (error) return fail("No se pudo actualizar la solicitud", 500);
    return json({ actualizada: true });
  }

  if (accion === "eliminar") {
    // Se borra también el currículum: guardar el archivo de alguien que ya
    // descartamos es acumular datos personales sin motivo.
    const { data: solicitud } = await db
      .from("requests").select("cv_path").eq("id", id).maybeSingle();

    if (solicitud?.cv_path) {
      await db.storage.from("curriculums").remove([solicitud.cv_path]);
    }

    const { error } = await db.from("requests").delete().eq("id", id);
    if (error) return fail("No se pudo eliminar la solicitud", 500);
    return json({ eliminada: true });
  }

  return fail("Acción desconocida");
});
