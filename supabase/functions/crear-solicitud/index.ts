import { serviceClient } from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";
import { hashVisitante } from "../_shared/visitante.ts";

/* Las tres bandejas del panel: postulaciones de empleo, pedidos de publicidad y
   reinicios de clave.

   Es pública, así que valida todo de nuevo del lado del servidor: lo que valide
   el navegador es una cortesía para quien completa el formulario, no una
   defensa. El currículum entra por acá y no directo a Storage porque subirlo
   desde el navegador obligaría a dejar el bucket abierto a escritura anónima. */

const MAX_CV_BYTES = 5 * 1024 * 1024;
const EXTENSIONES = ["pdf", "doc", "docx"];
const PALABRAS_MINIMAS = 6;
const MAX_POR_HORA = 5;

const DOMINIO_STAFF = "enprokart.com";

function texto(valor: unknown, max = 200): string {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

function contarPalabras(frase: string): number {
  return frase.split(/\s+/).filter((p) => p.length > 1).length;
}

/* Convierte el archivo que llegó en base64 a bytes.

   Se acepta tanto el base64 pelado como el data URL completo
   (`data:application/pdf;base64,...`), que es lo que devuelve FileReader. */
function bytesDesdeBase64(entrada: string): Uint8Array | null {
  const limpio = entrada.includes(",") ? entrada.slice(entrada.indexOf(",") + 1) : entrada;
  try {
    const binario = atob(limpio);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo inválido");
  }

  const kind = texto(body.kind, 20);
  if (!["empleo", "publicidad", "clave"].includes(kind)) {
    return fail("Tipo de solicitud desconocido");
  }

  const db = serviceClient();
  const origen = await hashVisitante(req);

  // Freno de abuso: sin esto, un script deja la bandeja del panel inservible en
  // un minuto. Se cuenta por origen y por hora.
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("requests")
    .select("id", { count: "exact", head: true })
    .eq("origin_hash", origen)
    .gte("created_at", haceUnaHora);

  if ((count ?? 0) >= MAX_POR_HORA) {
    return fail("Ya enviaste varias solicitudes. Prueba de nuevo en un rato.", 429);
  }

  const fila: Record<string, unknown> = { kind, origin_hash: origen };

  // ------------------------------------------------------------ cambio de clave
  if (kind === "clave") {
    const usuario = texto(body.usuario, 60).toLowerCase().replace(/@.*$/, "");
    if (!usuario) return fail("Escribe tu usuario");

    const email = `${usuario}@${DOMINIO_STAFF}`;
    const { data: perfil } = await db
      .from("staff_profiles")
      .select("id, email, display_name")
      .ilike("email", email)
      .maybeSingle();

    // Si el usuario no existe se responde lo mismo que si existiera. Decir
    // "ese usuario no existe" le confirma a un desconocido qué cuentas hay.
    if (!perfil) return json({ recibida: true });

    fila.staff_email = perfil.email;
    fila.nombre = perfil.display_name ?? usuario;

    // Un solo pedido pendiente por persona: si insiste, no se apilan diez.
    const { data: yaPidio } = await db
      .from("requests")
      .select("id")
      .eq("kind", "clave")
      .eq("staff_email", perfil.email)
      .eq("status", "nueva")
      .maybeSingle();

    if (yaPidio) return json({ recibida: true });
  }

  // ------------------------------------------------------------ datos comunes
  if (kind === "empleo" || kind === "publicidad") {
    fila.nombre = texto(body.nombre, 80);
    fila.apellido = texto(body.apellido, 80);
    fila.documento = texto(body.documento, 40);

    if (!fila.nombre || !fila.apellido) return fail("Faltan el nombre y el apellido");
    if (!fila.documento) return fail("Falta la cédula");
  }

  // ------------------------------------------------------------ publicidad
  if (kind === "publicidad") {
    fila.comercio = texto(body.comercio, 120);
    fila.descripcion = texto(body.descripcion, 1000);
    fila.whatsapp = texto(body.whatsapp, 40);

    if (!fila.comercio) return fail("Falta el nombre del comercio");
    if (contarPalabras(fila.descripcion as string) < PALABRAS_MINIMAS) {
      return fail(`Cuéntanos en al menos ${PALABRAS_MINIMAS} palabras qué publicidad necesitas`);
    }
  }

  // ------------------------------------------------------------ empleo
  if (kind === "empleo") {
    fila.whatsapp = texto(body.whatsapp, 40);
    fila.email = texto(body.email, 120);
    if (!fila.whatsapp) return fail("Falta el WhatsApp para poder contactarte");

    const nombreArchivo = texto(body.cv_nombre, 160);
    const extension = nombreArchivo.split(".").pop()?.toLowerCase() ?? "";
    if (!EXTENSIONES.includes(extension)) {
      return fail("El currículum tiene que ser PDF, DOC o DOCX");
    }

    const bytes = bytesDesdeBase64(String(body.cv_base64 ?? ""));
    if (!bytes || bytes.length === 0) return fail("No pudimos leer el archivo. Prueba de nuevo.");
    if (bytes.length > MAX_CV_BYTES) return fail("El currículum no puede pesar más de 5 MB");

    const ruta = `${crypto.randomUUID()}.${extension}`;
    const { error: subida } = await db.storage
      .from("curriculums")
      .upload(ruta, bytes, { contentType: "application/octet-stream", upsert: false });

    if (subida) {
      console.error("crear-solicitud/cv", subida);
      return fail("No pudimos guardar el currículum. Prueba de nuevo.", 500);
    }

    fila.cv_path = ruta;
  }

  const { error } = await db.from("requests").insert(fila);
  if (error) {
    console.error("crear-solicitud/insert", error);
    return fail("No pudimos registrar la solicitud. Prueba de nuevo.", 500);
  }

  return json({ recibida: true });
});
