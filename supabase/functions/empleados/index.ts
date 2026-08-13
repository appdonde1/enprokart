import {
  esAdmin,
  esRol,
  puedeActuarSobre,
  requireStaff,
  serviceClient,
  type StaffRole,
} from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";

/* Legajos, áreas, credenciales y marcaciones.

   Va por Edge Function y no leyendo tablas desde el navegador porque `empleados`
   guarda cédula, dirección, teléfono y sueldo, y no tiene ningún grant: ni para
   `anon` ni para `authenticated`. Se lee con la clave de servicio y solo después
   de confirmar que quien pregunta es admin. Es el mismo criterio con el que se
   cerraron `orders` y `tickets`.

   El legajo no es una cuenta de acceso. `dar_acceso` es lo que enlaza las dos
   cosas, y respeta la misma jerarquía que `staff-admin`: un admin solo puede
   otorgar acceso de mesero. */

const URL = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const UNIDADES = ["hora", "dia", "semana", "mes"];

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

// Sin caracteres que se confundan al dictarla por teléfono. Igual que en
// `staff-admin`: si alguna vez cambia una, tienen que cambiar las dos.
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

function limpio(valor: unknown, max = 160): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

function opcional(valor: unknown, max = 160): string | null {
  const s = limpio(valor, max);
  return s === "" ? null : s;
}

function fecha(valor: unknown): string | null {
  const s = limpio(valor, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function centavos(valor: unknown): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function porcentaje(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function diasLibres(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const limpios = valor.map((d) => limpio(d, 12).toLowerCase()).filter((d) => DIAS.includes(d));
  return [...new Set(limpios)];
}

// Cuando el archivo del captahuellas no trae un identificador propio, el hash de
// la línea original hace de identificador: reimportar el mismo archivo choca
// contra el índice único en vez de duplicar la marcación.
async function huella(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Todo lo que la ficha y el formulario necesitan de un legajo. `select("*")`
// traería lo mismo, pero enumerar deja a la vista qué se está exponiendo.
const CAMPOS = `
  id, codigo, nombre, apellido, documento, fecha_nacimiento, fecha_ingreso,
  telefono, email, direccion, area_id, credencial_id, dias_libres,
  salario_cents, salario_unidad, bono_pct, estado, fecha_retiro, motivo_retiro,
  staff_id, codigo_reloj, created_at,
  areas ( id, nombre ),
  credenciales ( id, nombre, da_acceso_panel, rol_sugerido )
`;

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);
  if (!esAdmin(staff.role)) return fail("Solo un administrador gestiona el personal", 403);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();
  const accion = body.action;

  // ---------------------------------------------------------------- catálogos

  if (accion === "catalogos") {
    const [{ data: areas }, { data: credenciales }, { data: ajustes }] = await Promise.all([
      db.from("areas").select("id, nombre, activa").order("nombre"),
      db.from("credenciales").select("id, nombre, activa, da_acceso_panel, rol_sugerido").order("nombre"),
      db.from("site_settings").select("horas_jornada").eq("id", true).maybeSingle(),
    ]);

    return json({
      areas: areas ?? [],
      credenciales: credenciales ?? [],
      horas_jornada: ajustes?.horas_jornada ?? 8,
    });
  }

  if (accion === "area_crear") {
    const nombre = limpio(body.nombre, 60);
    if (!nombre) return fail("Falta el nombre del área");

    const { data, error } = await db
      .from("areas").insert({ nombre }).select("id, nombre, activa").single();

    if (error) {
      if (error.code === "23505") return fail("Ya existe un área con ese nombre", 409);
      console.error("empleados/area_crear", error);
      return fail("No se pudo crear el área", 500);
    }
    return json({ area: data });
  }

  if (accion === "credencial_crear") {
    const nombre = limpio(body.nombre, 60);
    if (!nombre) return fail("Falta el nombre de la credencial");

    const daAcceso = body.da_acceso_panel === true;
    // El rol sugerido solo tiene sentido si la credencial da acceso, y nunca
    // puede sugerir `developer`: esa cuenta no se reparte por puesto.
    const rol = daAcceso && (body.rol_sugerido === "admin" || body.rol_sugerido === "mesero")
      ? body.rol_sugerido
      : null;

    const { data, error } = await db
      .from("credenciales")
      .insert({ nombre, da_acceso_panel: daAcceso, rol_sugerido: rol })
      .select("id, nombre, activa, da_acceso_panel, rol_sugerido")
      .single();

    if (error) {
      if (error.code === "23505") return fail("Ya existe una credencial con ese nombre", 409);
      console.error("empleados/credencial_crear", error);
      return fail("No se pudo crear la credencial", 500);
    }
    return json({ credencial: data });
  }

  /* Las bajas de catálogo no borran: apagan.

     Hay legajos que apuntan a estas filas, y la clave foránea es `on delete
     restrict` justamente para que un borrado no se lleve puesta la historia de
     quién trabajó en Cocina. Apagarla la saca de los desplegables y deja
     intactos los legajos viejos. */
  if (accion === "area_baja" || accion === "credencial_baja") {
    const tabla = accion === "area_baja" ? "areas" : "credenciales";
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta el id");

    const activa = body.activa === true;
    const { error } = await db.from(tabla).update({ activa }).eq("id", id);
    if (error) {
      console.error(`empleados/${accion}`, error);
      return fail("No se pudo actualizar", 500);
    }
    return json({ activa });
  }

  // ---------------------------------------------------------------- legajos

  if (accion === "listar") {
    const buscar = limpio(body.buscar, 60);
    const incluirRetirados = body.incluir_retirados === true;

    let consulta = db.from("empleados").select(CAMPOS).order("apellido").order("nombre");
    if (!incluirRetirados) consulta = consulta.eq("estado", "activo");

    // El buscador es por cédula, que es como se identifica a alguien acá; el
    // nombre se acepta igual porque nadie recuerda la cédula de todos.
    if (buscar) {
      const patron = `%${buscar.replace(/[%_]/g, "")}%`;
      consulta = consulta.or(
        `documento.ilike.${patron},nombre.ilike.${patron},apellido.ilike.${patron},codigo.ilike.${patron}`,
      );
    }

    const { data, error } = await consulta;
    if (error) {
      console.error("empleados/listar", error);
      return fail("No se pudo leer la lista", 500);
    }
    return json({ empleados: data ?? [] });
  }

  if (accion === "ficha") {
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta el id");

    const { data } = await db.from("empleados").select(CAMPOS).eq("id", id).maybeSingle();
    if (!data) return fail("Ese empleado no existe", 404);

    const { data: ajustes } = await db
      .from("site_settings").select("horas_jornada").eq("id", true).maybeSingle();

    return json({ empleado: data, horas_jornada: ajustes?.horas_jornada ?? 8 });
  }

  if (accion === "crear" || accion === "editar") {
    const nombre = limpio(body.nombre, 60);
    const apellido = limpio(body.apellido, 60);
    if (!nombre || !apellido) return fail("Hacen falta el nombre y el apellido");

    const unidad = UNIDADES.includes(body.salario_unidad) ? body.salario_unidad : "dia";

    const campos: Record<string, unknown> = {
      nombre,
      apellido,
      documento: opcional(body.documento, 30),
      fecha_nacimiento: fecha(body.fecha_nacimiento),
      telefono: opcional(body.telefono, 30),
      email: opcional(body.email, 120),
      direccion: opcional(body.direccion, 200),
      area_id: opcional(body.area_id, 40),
      credencial_id: opcional(body.credencial_id, 40),
      dias_libres: diasLibres(body.dias_libres),
      salario_cents: centavos(body.salario_cents),
      salario_unidad: unidad,
      bono_pct: porcentaje(body.bono_pct),
      codigo_reloj: opcional(body.codigo_reloj, 40),
      updated_at: new Date().toISOString(),
    };

    if (accion === "crear") {
      campos.fecha_ingreso = fecha(body.fecha_ingreso) ?? new Date().toISOString().slice(0, 10);

      const { data, error } = await db.from("empleados").insert(campos).select(CAMPOS).single();
      if (error) {
        if (error.code === "23505") return fail("Ya hay un empleado con esa cédula o ese código de reloj", 409);
        console.error("empleados/crear", error);
        return fail("No se pudo crear el empleado", 500);
      }
      return json({ empleado: data });
    }

    const id = limpio(body.id, 40);
    if (!id) return fail("Falta el id");
    if (fecha(body.fecha_ingreso)) campos.fecha_ingreso = fecha(body.fecha_ingreso);

    const { data, error } = await db
      .from("empleados").update(campos).eq("id", id).select(CAMPOS).single();

    if (error) {
      if (error.code === "23505") return fail("Ya hay un empleado con esa cédula o ese código de reloj", 409);
      console.error("empleados/editar", error);
      return fail("No se pudo guardar el empleado", 500);
    }
    return json({ empleado: data });
  }

  /* Retirar y reingresar.

     Un empleado nunca se borra. Retirarlo lo saca de la lista activa y conserva
     su código, su historial de nómina y sus marcaciones; reingresarlo lo
     devuelve con todo eso intacto. No existe ninguna acción que borre un legajo,
     a propósito: es el registro de a quién se le pagó. */
  if (accion === "retirar") {
    const id = limpio(body.id, 40);
    const motivo = limpio(body.motivo, 300);
    if (!id) return fail("Falta el id");
    if (motivo.length < 3) return fail("Hace falta el motivo del retiro");

    const { error } = await db
      .from("empleados")
      .update({
        estado: "retirado",
        fecha_retiro: fecha(body.fecha) ?? new Date().toISOString().slice(0, 10),
        motivo_retiro: motivo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("empleados/retirar", error);
      return fail("No se pudo retirar al empleado", 500);
    }
    return json({ retirado: true });
  }

  if (accion === "reingresar") {
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta el id");

    const { error } = await db
      .from("empleados")
      .update({
        estado: "activo",
        fecha_retiro: null,
        motivo_retiro: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("empleados/reingresar", error);
      return fail("No se pudo reingresar al empleado", 500);
    }
    return json({ reingresado: true });
  }

  // ---------------------------------------------------------------- acceso al panel

  /* Le crea una cuenta a quien además tiene que entrar al panel.

     La jerarquía es la misma que en `staff-admin`, y por el mismo motivo: si
     acá no se verificara, un admin podría fabricarse otro admin dándole acceso
     a un legajo cualquiera. */
  if (accion === "dar_acceso") {
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta el id");

    const rol: StaffRole = esRol(body.role) ? body.role : "mesero";
    if (rol === "developer") return fail("La cuenta de desarrollo no se otorga desde acá", 403);
    if (!puedeActuarSobre(staff.role, rol)) {
      return fail("Solo la cuenta de desarrollo puede crear administradores", 403);
    }

    const { data: empleado } = await db
      .from("empleados").select("id, nombre, apellido, email, staff_id").eq("id", id).maybeSingle();

    if (!empleado) return fail("Ese empleado no existe", 404);
    if (empleado.staff_id) return fail("Ese empleado ya tiene acceso al panel", 409);

    const email = String(empleado.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      return fail("El legajo necesita un correo válido antes de darle acceso");
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
      console.error("empleados/dar_acceso", error);
      return fail("No se pudo crear la cuenta", 500);
    }

    const { error: perfilError } = await db.from("staff_profiles").insert({
      id: usuario.id,
      email,
      role: rol,
      display_name: `${empleado.nombre} ${empleado.apellido}`.trim(),
      must_change_password: true,
      admin_code: rol === "mesero" ? null : codigoAdmin(),
      created_by: staff.userId,
    });

    if (perfilError) {
      // Sin perfil la cuenta no sirve para nada: se deshace para no dejar basura.
      await authAdmin(`/users/${usuario.id}`, { method: "DELETE" }).catch(() => {});
      console.error("empleados/dar_acceso perfil", perfilError);
      return fail("No se pudo crear el perfil", 500);
    }

    await db
      .from("empleados")
      .update({ staff_id: usuario.id, updated_at: new Date().toISOString() })
      .eq("id", id);

    return json({ email, temporary_password: pass, role: rol });
  }

  // ---------------------------------------------------------------- marcaciones

  /* Importa las marcaciones de un captahuellas que todavía no está elegido.

     El navegador manda las filas ya mapeadas —cuál columna es el identificador,
     cuál la fecha, cuál el tipo de marca— porque no se puede asumir un formato
     que nadie vio. Acá se guarda cada fila con su línea original al lado, y esa
     línea es lo que permitirá rehacer la interpretación cuando llegue el equipo
     real sin tener que volver a exportar del aparato.

     Lo que NO hace es calcular horas. Sin el formato real, cualquier fórmula
     sería una suposición sobre el dinero de otras personas. */
  if (accion === "marcaciones_importar") {
    const filas = Array.isArray(body.filas) ? body.filas.slice(0, 5000) : [];
    if (!filas.length) return fail("No llegó ninguna marcación");

    const { data: empleados } = await db
      .from("empleados").select("id, codigo_reloj").not("codigo_reloj", "is", null);

    const porReloj = new Map<string, string>();
    for (const e of empleados ?? []) porReloj.set(String(e.codigo_reloj), e.id);

    const preparadas: Record<string, unknown>[] = [];
    const descartadas: string[] = [];

    for (const fila of filas) {
      const bruto = limpio(fila?.bruto, 2000);
      if (!bruto) continue;

      const momento = new Date(String(fila?.momento ?? ""));
      if (Number.isNaN(momento.getTime())) {
        descartadas.push(bruto);
        continue;
      }

      const codigoReloj = limpio(fila?.codigo_reloj, 40);
      const referencia = limpio(fila?.referencia_externa, 120) || await huella(bruto);

      preparadas.push({
        empleado_id: porReloj.get(codigoReloj) ?? null,
        codigo_reloj: codigoReloj || null,
        momento: momento.toISOString(),
        tipo: fila?.tipo === "salida" ? "salida" : "entrada",
        origen: fila?.origen === "manual" ? "manual" : "captahuellas",
        cargado_por: staff.userId,
        referencia_externa: referencia,
        bruto,
      });
    }

    if (!preparadas.length) {
      return json({ insertadas: 0, repetidas: 0, sin_empleado: 0, descartadas: descartadas.length });
    }

    // `ignoreDuplicates` es lo que hace idempotente la reimportación: la segunda
    // vez que entra el mismo archivo, el índice único sobre `referencia_externa`
    // rechaza las filas repetidas en vez de duplicarlas.
    const { data: insertadas, error } = await db
      .from("marcaciones")
      .upsert(preparadas, { onConflict: "referencia_externa", ignoreDuplicates: true })
      .select("id, empleado_id");

    if (error) {
      console.error("empleados/marcaciones_importar", error);
      return fail("No se pudieron guardar las marcaciones", 500);
    }

    const entraron = insertadas ?? [];
    return json({
      insertadas: entraron.length,
      repetidas: preparadas.length - entraron.length,
      sin_empleado: entraron.filter((m: any) => !m.empleado_id).length,
      descartadas: descartadas.length,
    });
  }

  if (accion === "marcaciones_listar") {
    const id = limpio(body.empleado_id, 40);

    let consulta = db
      .from("marcaciones")
      .select("id, empleado_id, codigo_reloj, momento, tipo, origen, referencia_externa, bruto")
      .order("momento", { ascending: false })
      .limit(300);

    if (id) consulta = consulta.eq("empleado_id", id);

    const { data } = await consulta;
    return json({ marcaciones: data ?? [] });
  }

  return fail("Acción desconocida");
});
