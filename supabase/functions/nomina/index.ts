import { esAdmin, requireStaff, serviceClient } from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";
import {
  bonoCents,
  enteroSeguro,
  esUnidad,
  salarioSemanalCents,
  totalLineaCents,
} from "../_shared/dinero.ts";

/* La nómina semanal.

   Tres reglas la sostienen, y las tres están acá y no en el navegador:

   1. Cada semana guarda su propia copia de los números. Si la línea leyera el
      sueldo actual del legajo, subirle el sueldo a alguien en octubre cambiaría
      lo que dice que se le pagó en marzo, y nadie podría reconstruir un pago
      viejo. Es el mismo criterio que ya usa la entrada emitida, que guarda su
      sección y su mesa aunque después cambie el salón.

   2. Todo cambio de sueldo, bono o descuento exige motivo y el código de
      administrador de 3 dígitos. El código se compara de este lado y nunca viaja
      al navegador: tener la sesión abierta no alcanza para tocar el dinero de
      alguien. Es el mismo PIN que ya protege las cortesías.

   3. Los ajustes no se editan ni se borran. Si algo salió mal se agrega otro que
      lo corrige, y quedan los dos. La base tiene un trigger que lo impide aunque
      la orden venga de acá con la clave de servicio.

   Lo que se cobra por mesas NO entra en este archivo. Son circuitos separados:
   ninguna consulta de acá toca `orders`, `tickets` ni `seats`. Cruzarlos volvería
   la nómina dependiente de una noche floja de ventas, que no es lo que se le
   prometió a nadie que trabaja. */

function limpio(valor: unknown, max = 300): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

function fecha(valor: unknown): string | null {
  const s = limpio(valor, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function porcentaje(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  const staff = await requireStaff(req);
  if (!staff) return fail("Necesitas iniciar sesión", 401);
  if (!esAdmin(staff.role)) return fail("Solo un administrador ve la nómina", 403);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const db = serviceClient();
  const accion = body.action;

  /* El PIN de 3 dígitos. Idéntico al de `courtesy-ticket`, incluida la bandera
     `bad_code`, que le sirve al panel para distinguir "código mal" de cualquier
     otro 403 y volver a pedirlo en vez de mandar a la persona al login. */
  const exigirCodigo = async (): Promise<Response | null> => {
    const { data: perfil } = await db
      .from("staff_profiles").select("admin_code").eq("id", staff.userId).maybeSingle();

    if (!perfil?.admin_code) return fail("Tu cuenta no tiene código de administrador", 403);
    if (String(body.admin_code ?? "").trim() !== perfil.admin_code) {
      return fail("Código de administrador incorrecto", 403, { bad_code: true });
    }
    return null;
  };

  const horasJornada = async (): Promise<number> => {
    const { data } = await db
      .from("site_settings").select("horas_jornada").eq("id", true).maybeSingle();
    return data?.horas_jornada ?? 8;
  };

  /* Le arma una línea a cada empleado activo que todavía no la tenga.

     El sueldo del legajo puede estar cargado por hora, por día, por semana o por
     mes; acá se lleva a semana una sola vez y en enteros, con `dinero.ts`. */
  const armarLineas = async (semanaId: string): Promise<number> => {
    const horas = await horasJornada();

    const { data: empleados } = await db
      .from("empleados")
      .select("id, salario_cents, salario_unidad, bono_pct")
      .eq("estado", "activo");

    const { data: existentes } = await db
      .from("nomina_lineas").select("empleado_id").eq("semana_id", semanaId);

    const yaEstan = new Set((existentes ?? []).map((l: any) => l.empleado_id));

    const nuevas = (empleados ?? [])
      .filter((e: any) => !yaEstan.has(e.id))
      .map((e: any) => {
        const unidad = esUnidad(e.salario_unidad) ? e.salario_unidad : "dia";
        const base = salarioSemanalCents(e.salario_cents, unidad, horas);
        const pct = e.bono_pct === null ? null : Number(e.bono_pct);

        return {
          semana_id: semanaId,
          empleado_id: e.id,
          salario_base_cents: base,
          bono_pct: pct,
          bono_cents: bonoCents(base, pct),
          descuento_cents: 0,
          total_cents: totalLineaCents(base, pct, 0),
        };
      });

    if (!nuevas.length) return 0;

    const { data, error } = await db.from("nomina_lineas").insert(nuevas).select("id");
    if (error) {
      console.error("nomina/armarLineas", error);
      return 0;
    }
    return (data ?? []).length;
  };

  // ---------------------------------------------------------------- semanas

  if (accion === "semanas") {
    const { data } = await db
      .from("nomina_semanas")
      .select("id, desde, hasta, estado, cerrada_en, created_at")
      .order("desde", { ascending: false })
      .limit(104);
    return json({ semanas: data ?? [] });
  }

  /* Abre una semana y le arma una línea a cada empleado activo.

     La línea nace con el sueldo copiado del legajo: a partir de ahí la semana es
     independiente. Un aumento cargado el jueves no reescribe lo que la semana ya
     dice, y para aplicarlo hay que hacer un ajuste, con motivo y código, que
     queda registrado. */
  if (accion === "semana_abrir") {
    const desde = fecha(body.desde);
    const hasta = fecha(body.hasta);
    if (!desde || !hasta) return fail("Hacen falta las dos fechas de la semana");
    if (hasta < desde) return fail("La semana termina antes de empezar");

    const { data: semana, error } = await db
      .from("nomina_semanas").insert({ desde, hasta }).select("id, desde, hasta, estado").single();

    if (error) {
      if (error.code === "23505") return fail("Esa semana ya existe", 409);
      console.error("nomina/semana_abrir", error);
      return fail("No se pudo abrir la semana", 500);
    }

    const creadas = await armarLineas(semana.id);
    return json({ semana, lineas_creadas: creadas });
  }

  // Empleados que entraron después de abrir la semana. Sin esto habría que
  // cerrar y volver a abrir, perdiendo los ajustes ya cargados.
  if (accion === "semana_sincronizar") {
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta la semana");

    const { data: semana } = await db
      .from("nomina_semanas").select("id, estado").eq("id", id).maybeSingle();

    if (!semana) return fail("Esa semana no existe", 404);
    if (semana.estado === "cerrada") return fail("La semana está cerrada", 409);

    const creadas = await armarLineas(id);
    return json({ lineas_creadas: creadas });
  }

  if (accion === "semana_ver") {
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta la semana");

    const { data: semana } = await db
      .from("nomina_semanas")
      .select("id, desde, hasta, estado, cerrada_en, cerrada_por")
      .eq("id", id)
      .maybeSingle();

    if (!semana) return fail("Esa semana no existe", 404);

    const { data: lineas } = await db
      .from("nomina_lineas")
      .select(`
        id, empleado_id, empleado_codigo, empleado_nombre, empleado_documento,
        salario_base_cents, bono_pct, bono_cents, descuento_cents, total_cents,
        horas_trabajadas,
        empleados ( codigo, nombre, apellido, documento, estado,
                    areas ( nombre ), credenciales ( nombre ) ),
        nomina_ajustes ( id, tipo, valor_cents, porcentaje, motivo,
                         hecho_por, hecho_por_nombre, hecho_en )
      `)
      .eq("semana_id", id);

    /* Quién hizo cada ajuste sale del propio ajuste, que copió el nombre al
       hacerlo. Solo se busca en `staff_profiles` para los ajustes viejos, de
       antes de que existiera esa columna: si la cuenta ya no está, el ajuste
       igual dice que hubo uno y por qué. */
    const autores = new Set<string>();
    for (const l of lineas ?? []) {
      for (const a of (l as any).nomina_ajustes ?? []) {
        if (a.hecho_por && !a.hecho_por_nombre) autores.add(a.hecho_por);
      }
    }

    const nombres = new Map<string, string>();
    if (autores.size) {
      const { data: perfiles } = await db
        .from("staff_profiles").select("id, display_name, email").in("id", [...autores]);
      for (const p of perfiles ?? []) nombres.set(p.id, p.display_name || p.email);
    }

    const filas = (lineas ?? []).map((l: any) => ({
      ...l,
      // Mientras la semana está abierta la línea muestra el nombre vivo del
      // legajo; al cerrarse queda la copia. Así una corrección de tipeo en el
      // apellido se ve enseguida, y deja de verse cuando el pago ya se hizo.
      nombre: l.empleado_nombre ??
        `${l.empleados?.nombre ?? ""} ${l.empleados?.apellido ?? ""}`.trim(),
      documento: l.empleado_documento ?? l.empleados?.documento ?? null,
      codigo: l.empleado_codigo ?? l.empleados?.codigo ?? null,
      area: l.empleados?.areas?.nombre ?? null,
      credencial: l.empleados?.credenciales?.nombre ?? null,
      ajustes: (l.nomina_ajustes ?? [])
        .map((a: any) => ({
          ...a,
          quien: a.hecho_por_nombre ?? nombres.get(a.hecho_por) ?? "sin registrar",
        }))
        .sort((a: any, b: any) => String(b.hecho_en).localeCompare(String(a.hecho_en))),
    }))
      .sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), "es"));

    return json({
      semana,
      lineas: filas,
      total_cents: filas.reduce((suma, f) => suma + enteroSeguro(f.total_cents), 0),
    });
  }

  /* Cierra la semana y congela sus números.

     Acá se vuelca la copia de identidad: nombre, cédula y código quedan escritos
     en la línea. Después de esto el legajo puede cambiar de nombre, de sueldo o
     retirarse, y la semana sigue diciendo exactamente lo que se pagó.

     Pide el código de administrador porque es la operación irreversible: una vez
     cerrada, ni un ajuste entra. */
  if (accion === "semana_cerrar") {
    const id = limpio(body.id, 40);
    if (!id) return fail("Falta la semana");

    const { data: semana } = await db
      .from("nomina_semanas").select("id, estado").eq("id", id).maybeSingle();

    if (!semana) return fail("Esa semana no existe", 404);
    if (semana.estado === "cerrada") return fail("Esa semana ya está cerrada", 409);

    const malCodigo = await exigirCodigo();
    if (malCodigo) return malCodigo;

    const { data: lineas } = await db
      .from("nomina_lineas")
      .select("id, empleados ( codigo, nombre, apellido, documento )")
      .eq("semana_id", id);

    for (const l of lineas ?? []) {
      const e = (l as any).empleados;
      await db
        .from("nomina_lineas")
        .update({
          empleado_codigo: e?.codigo ?? null,
          empleado_nombre: e ? `${e.nombre} ${e.apellido}`.trim() : null,
          empleado_documento: e?.documento ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", l.id);
    }

    const { error } = await db
      .from("nomina_semanas")
      .update({ estado: "cerrada", cerrada_por: staff.userId, cerrada_en: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("nomina/semana_cerrar", error);
      return fail("No se pudo cerrar la semana", 500);
    }
    return json({ cerrada: true, lineas: (lineas ?? []).length });
  }

  // ---------------------------------------------------------------- ajustes

  /* Cambia el sueldo, el bono o el descuento de una línea.

     `sueldo` y `bono` traen el valor nuevo, absoluto. `descuento` suma: aplicar
     dos descuentos en la misma semana los acumula, y para deshacer uno se manda
     otro negativo. En los tres casos queda un renglón en `nomina_ajustes` con el
     motivo, quién y cuándo, y ese renglón ya no se puede tocar. */
  if (accion === "linea_ajustar") {
    const lineaId = limpio(body.linea_id, 40);
    const tipo = body.tipo;
    const motivo = limpio(body.motivo, 300);

    if (!lineaId) return fail("Falta la línea");
    if (tipo !== "sueldo" && tipo !== "bono" && tipo !== "descuento") {
      return fail("Tipo de ajuste desconocido");
    }
    if (motivo.length < 5) return fail("Hace falta un motivo: sin él el ajuste no queda justificado");

    const { data: linea } = await db
      .from("nomina_lineas")
      .select("id, semana_id, salario_base_cents, bono_pct, descuento_cents, nomina_semanas ( estado )")
      .eq("id", lineaId)
      .maybeSingle();

    if (!linea) return fail("Esa línea no existe", 404);
    if ((linea as any).nomina_semanas?.estado === "cerrada") {
      return fail("Esa semana está cerrada: sus números ya no se tocan", 409);
    }

    const malCodigo = await exigirCodigo();
    if (malCodigo) return malCodigo;

    let base = enteroSeguro(linea.salario_base_cents);
    let pct: number | null = linea.bono_pct === null ? null : Number(linea.bono_pct);
    let descuento = enteroSeguro(linea.descuento_cents);

    let valorCents: number | null = null;
    let valorPct: number | null = null;

    if (tipo === "sueldo") {
      valorCents = enteroSeguro(body.valor_cents);
      if (valorCents < 0) return fail("Un sueldo no puede ser negativo");
      base = valorCents;
    } else if (tipo === "bono") {
      valorPct = porcentaje(body.porcentaje);
      if (valorPct === null) return fail("El bono va entre 0 y 100 por ciento");
      pct = valorPct;
    } else {
      valorCents = enteroSeguro(body.valor_cents);
      if (valorCents === 0) return fail("Un descuento de cero no cambia nada");
      descuento = Math.max(0, descuento + valorCents);
    }

    /* El nombre del autor se copia acá, no se resuelve al leer. Un ajuste no se
       puede actualizar nunca, así que tampoco puede recibir el `set null` de una
       cuenta borrada: si el autor viviera solo como llave foránea, eliminar a un
       administrador dejaría ajustes sin autor —o, peor, impediría eliminarlo—. */
    const { data: autor } = await db
      .from("staff_profiles").select("display_name, email").eq("id", staff.userId).maybeSingle();

    const { error: ajusteError } = await db.from("nomina_ajustes").insert({
      linea_id: lineaId,
      tipo,
      valor_cents: valorCents,
      porcentaje: valorPct,
      motivo,
      hecho_por: staff.userId,
      hecho_por_nombre: autor?.display_name || autor?.email || null,
    });

    if (ajusteError) {
      console.error("nomina/linea_ajustar ajuste", ajusteError);
      return fail("No se pudo registrar el ajuste", 500);
    }

    /* El ajuste se guarda ANTES de recalcular, a propósito. Si el recálculo
       fallara, queda el rastro de lo que se intentó hacer y quién lo intentó;
       al revés quedaría un número cambiado sin explicación, que es exactamente
       lo que esta tabla existe para evitar. */
    const { data: actualizada, error } = await db
      .from("nomina_lineas")
      .update({
        salario_base_cents: base,
        bono_pct: pct,
        bono_cents: bonoCents(base, pct),
        descuento_cents: descuento,
        total_cents: totalLineaCents(base, pct, descuento),
        updated_at: new Date().toISOString(),
      })
      .eq("id", lineaId)
      .select("id, salario_base_cents, bono_pct, bono_cents, descuento_cents, total_cents")
      .single();

    if (error) {
      console.error("nomina/linea_ajustar recalculo", error);
      return fail("El ajuste quedó registrado pero no se pudo recalcular la línea", 500);
    }

    return json({ linea: actualizada });
  }

  return fail("Acción desconocida");
});
