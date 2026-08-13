/* Lo que comparten los scripts de verificación.

   Cero dependencias: `fetch` es nativo desde Node 18 y `node:test` viene con el
   runtime. El proyecto no tiene build ni bundler, y esto no lo cambia: son
   archivos sueltos que se corren con `node`.

   Las credenciales salen del entorno, nunca del repo. La anon key es pública
   igual (vive en `01 - Entradas/js/config.js`), pero las claves de las cuentas
   de prueba no, y por eso no hay ningún valor por defecto para ellas. */

const URL_POR_DEFECTO = "https://tgilgfwxtghcqskfyzif.supabase.co";

export const cfg = {
  url: process.env.PK_URL ?? URL_POR_DEFECTO,
  anon: process.env.PK_ANON ?? "",
};

export function exigirEntorno(...nombres) {
  const faltan = nombres.filter((n) => !process.env[n]);
  if (faltan.length) {
    console.error(
      `\nFaltan variables de entorno: ${faltan.join(", ")}\n` +
      "Mirá verificacion/README.md para saber qué poner en cada una.\n",
    );
    process.exit(1);
  }
}

/* Inicia sesión y devuelve el token. Se usa el endpoint de GoTrue directo en vez
   del SDK para no depender de nada instalado. */
export async function entrar(email, password) {
  const r = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`No se pudo entrar como ${email}: ${datos.error_description ?? r.status}`);
  return datos.access_token;
}

/* Llama a una Edge Function y devuelve el estado junto con el cuerpo.

   Devuelve el estado en vez de lanzar: casi todo lo que se verifica acá es
   justamente que un 403 llegue cuando tiene que llegar. */
export async function fn(nombre, cuerpo, token) {
  const r = await fetch(`${cfg.url}/functions/v1/${nombre}`, {
    method: "POST",
    headers: {
      apikey: cfg.anon,
      Authorization: `Bearer ${token ?? cfg.anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });

  return { status: r.status, datos: await r.json().catch(() => ({})) };
}

/* Lectura directa por PostgREST, sin pasar por ninguna función. Sirve para
   comprobar qué alcanza a ver una clave por sí sola. */
export async function leer(tabla, token, consulta = "select=*&limit=1") {
  const r = await fetch(`${cfg.url}/rest/v1/${tabla}?${consulta}`, {
    headers: {
      apikey: cfg.anon,
      Authorization: `Bearer ${token ?? cfg.anon}`,
    },
  });

  return { status: r.status, datos: await r.json().catch(() => ({})) };
}
