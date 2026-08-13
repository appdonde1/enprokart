import {
  esAdmin,
  esRol,
  puedeActuarSobre,
  requireStaff,
  serviceClient,
  type StaffRole,
} from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Alta y gestión del personal.

   Crear cuentas exige la clave de servicio, que no puede vivir en el navegador,
   por eso pasa por acá. Cada llamada verifica que quien pide sea admin.

   La jerarquía se aplica de este lado y no en el navegador: un admin gestiona
   meseros, y entre administradores no hay ninguna acción disponible. Editar,
   degradar o eliminar a un admin o a la cuenta de desarrollo lo hace solo el
   developer. Esconder los botones en el panel es comodidad; lo que decide es
   `puedeActuarSobre()`. */

const URL = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

// Sin caracteres que se confundan al dictarla por teléfono.
function claveTemporal(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let s = "";
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10)}`;
}

function codigoAdmin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900 + 100;
  return String(n);
}

async function authAdmin(ruta: string, opciones: RequestInit = {}) {
  const res = await fetch(`${URL}/auth/v1/admin${ruta}`, {
    ...opciones,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(cuerpo?.msg ?? cuerpo?.message ?? `HTTP ${res.status}`);
  return cuerpo;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();
  const accion = body.action;

  /* Cambiar la propia clave: lo hace cualquiera del personal, no solo un admin.
     Va antes del control de rol porque un mesero obligado a cambiar su clave
     tiene que poder hacerlo; si esto exigiera ser admin, quedaría encerrado.

     Solo toca al que llama: el id sale de la sesión, nunca del cuerpo. */
  if (accion === "change_own_password") {
    const nueva = String(body.new_password ?? "");

    if (nueva.length < 8) return fail("La clave nueva necesita al menos 8 caracteres");
    if (!/[a-zA-Z]/.test(nueva) || !/[0-9]/.test(nueva)) {
      return fail("La clave nueva tiene que combinar letras y números");
    }

    try {
      await authAdmin(`/users/${staff.userId}`, {
        method: "PUT",
        body: JSON.stringify({ password: nueva }),
      });
    } catch (error) {
      console.error("staff-admin/change_own", error);
      return fail("No se pudo cambiar la clave", 500);
    }

    await db
      .from("staff_profiles")
      .update({ must_change_password: false, last_password_change: new Date().toISOString() })
      .eq("id", staff.userId);

    return json({ changed: true });
  }

  if (!esAdmin(staff.role)) return fail("Solo un administrador puede gestionar personal", 403);

  /* El rol pedido, siempre desde una lista blanca: nunca se guarda lo que venga
     en el cuerpo. Lo que no se reconoce cae en el rol de menos permisos. */
  const rolPedido = (): StaffRole => (esRol(body.role) ? body.role : "mesero");

  /* La guarda de todas las acciones que apuntan a otra cuenta.

     Primero la propia cuenta: un admin no tiene acciones sobre sí mismo (para
     su clave existe `change_own_password`). Después la jerarquía, leyendo el rol
     que la cuenta tiene HOY en la base y no el que venga en el pedido. */
  const bloqueo = async (id: string): Promise<Response | null> => {
    if (id === staff.userId && staff.role !== "developer") {
      return fail("No puedes usar esta acción sobre tu propia cuenta", 400);
    }

    const { data } = await db
      .from("staff_profiles").select("role").eq("id", id).maybeSingle();

    if (!data) return fail("Esa cuenta no existe", 404);

    if (!puedeActuarSobre(staff.role, data.role as StaffRole)) {
      return fail("Solo la cuenta de desarrollo puede gestionar administradores", 403);
    }
    return null;
  };

  if (accion === "list") {
    const { data } = await db
      .from("staff_profiles")
      .select("id, email, role, display_name, must_change_password, last_password_change, created_at")
      .order("created_at");

    /* Se listan todas, incluida la de desarrollo. Una cuenta con poder total,
       oculta y permanente dentro del sistema de otra persona es una puerta
       trasera, aunque la intención sea buena: la dueña tiene que poder ver que
       existe. Lo que no puede es tocarla, y eso lo dice `gestionable`. */
    const staffs = (data ?? []).map((f) => ({
      ...f,
      es_uno_mismo: f.id === staff.userId,
      gestionable: f.id !== staff.userId && puedeActuarSobre(staff.role, f.role as StaffRole),
    }));

    return json({ staff: staffs, mi_rol: staff.role });
  }

  if (accion === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const nombre = String(body.display_name ?? "").trim();
    const rol = rolPedido();

    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return fail("Correo inválido");

    if (!puedeActuarSobre(staff.role, rol)) {
      return fail("Solo la cuenta de desarrollo puede crear administradores", 403);
    }

    const pass = claveTemporal();
    let usuario;
    try {
      usuario = await authAdmin("/users", {
        method: "POST",
        body: JSON.stringify({ email, password: pass, email_confirm: true }),
      });
    } catch (error) {
      const msg = String(error);
      if (msg.includes("already") || msg.includes("registered")) {
        return fail("Ya existe una cuenta con ese correo", 409);
      }
      console.error("staff-admin/create", error);
      return fail("No se pudo crear la cuenta", 500);
    }

    const { error: perfilError } = await db.from("staff_profiles").insert({
      id: usuario.id,
      email,
      role: rol,
      display_name: nombre || email.split("@")[0],
      must_change_password: true,
      // El developer también firma ajustes de nómina: necesita su PIN igual que
      // un admin. Solo el mesero se queda sin.
      admin_code: rol === "mesero" ? null : codigoAdmin(),
      created_by: staff.userId,
    });

    if (perfilError) {
      // Sin perfil la cuenta no sirve para nada: se deshace para no dejar basura.
      await authAdmin(`/users/${usuario.id}`, { method: "DELETE" }).catch(() => {});
      return fail("No se pudo crear el perfil", 500);
    }

    return json({ created: true, email, temporary_password: pass, role: rol });
  }

  if (accion === "update_role") {
    const id = String(body.id ?? "");
    const rol = rolPedido();
    if (!id) return fail("Falta el id");

    const rechazo = await bloqueo(id);
    if (rechazo) return rechazo;

    // No alcanza con poder tocar a la cuenta: hay que poder otorgar ese rol.
    // Si no, un admin podría promover a un mesero hasta administrador y así
    // saltarse la jerarquía por la puerta de al lado.
    if (!puedeActuarSobre(staff.role, rol)) {
      return fail("Solo la cuenta de desarrollo puede nombrar administradores", 403);
    }

    const parche: Record<string, unknown> = { role: rol };
    if (rol === "mesero") {
      parche.admin_code = null;
    } else {
      const { data: actual } = await db
        .from("staff_profiles").select("admin_code").eq("id", id).maybeSingle();
      if (!actual?.admin_code) parche.admin_code = codigoAdmin();
    }

    const { error } = await db.from("staff_profiles").update(parche).eq("id", id);
    if (error) return fail("No se pudo cambiar el rol", 500);
    return json({ updated: true });
  }

  if (accion === "reset_password") {
    const id = String(body.id ?? "");
    if (!id) return fail("Falta el id");

    const rechazo = await bloqueo(id);
    if (rechazo) return rechazo;

    const pass = claveTemporal();
    try {
      await authAdmin(`/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ password: pass }),
      });
    } catch (error) {
      console.error("staff-admin/reset", error);
      return fail("No se pudo restablecer la clave", 500);
    }

    await db.from("staff_profiles").update({ must_change_password: true }).eq("id", id);
    return json({ reset: true, temporary_password: pass });
  }

  if (accion === "delete") {
    const id = String(body.id ?? "");
    if (!id) return fail("Falta el id");

    // Vale también para el developer: borrarse con la sesión abierta deja el
    // sistema sin nadie que pueda gestionar administradores. Para entregar el
    // proyecto, primero se degrada la cuenta y después la elimina otra.
    if (id === staff.userId) return fail("No puedes eliminar tu propia cuenta", 400);

    const rechazo = await bloqueo(id);
    if (rechazo) return rechazo;

    // El legajo no se toca: `empleados.staff_id` es `on delete set null`, así
    // que la persona pierde el acceso y sigue existiendo como empleado.
    await db.from("staff_profiles").delete().eq("id", id);
    try {
      await authAdmin(`/users/${id}`, { method: "DELETE" });
    } catch (error) {
      console.error("staff-admin/delete", error);
    }
    return json({ deleted: true });
  }

  if (accion === "my_code") {
    const { data } = await db
      .from("staff_profiles").select("admin_code").eq("id", staff.userId).maybeSingle();
    return json({ admin_code: data?.admin_code ?? null });
  }

  return fail("Acción desconocida");
});
