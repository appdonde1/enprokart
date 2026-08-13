/* Sube al bucket `medios` los avisos de la casa regenerados.
 *
 * Por qué hace falta un script y no se hizo directo: subir a `medios` exige
 * sesión iniciada y que `is_admin()` dé verdadero (ver la política "admin sube
 * medios" en 20260812000014). La anon key que vive en js/config.js solo puede
 * leer, que es exactamente como tiene que ser. Este script inicia sesión con tu
 * usuario del panel, sube los dos archivos y sale.
 *
 * Uso, desde la raíz del repositorio:
 *
 *   PK_EMAIL=vos@enprokart.com PK_PASS='tu-clave' node supabase/scripts/subir-avisos.mjs
 *
 * En PowerShell:
 *
 *   $env:PK_EMAIL='vos@enprokart.com'; $env:PK_PASS='tu-clave'
 *   node supabase/scripts/subir-avisos.mjs
 *
 * La clave no queda escrita en ningún lado: se lee del entorno y se usa una vez.
 * Si preferís no usar la terminal, lo mismo se hace desde el panel, en
 * Publicidad, reemplazando la pieza vitalicia de cada espacio.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");

const SB = "https://tgilgfwxtghcqskfyzif.supabase.co";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnaWxnZnd4dGdoY3Fza2Z5emlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODk5NjYsImV4cCI6MjEwMjA2NTk2Nn0.yzxMEEw8QezoKrJnNltue5bpcueTJUL2jB1T9Kvz2Kw";

// Los dos avisos de la casa. La ruta destino tiene que ser la misma que ya
// tiene cargada la fila de `ads` en la base, o el sitio va a seguir pidiendo la
// vieja: el script la lee de ahí y no la inventa.
const PIEZAS = [
  { slot: "banner", archivo: "01 - Entradas/placeholders/banner_vitalica.jpg" },
  { slot: "overlay", archivo: "01 - Entradas/placeholders/Overlay_vitalicia.jpg" },
];

const email = process.env.PK_EMAIL;
const pass = process.env.PK_PASS;

if (!email || !pass) {
  console.error("Faltan PK_EMAIL y PK_PASS. Mirá el comentario de arriba del archivo.");
  process.exit(1);
}

async function json(res) {
  const t = await res.text();
  try { return JSON.parse(t); } catch { return t; }
}

// ------------------------------------------------------------------ sesión
const login = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pass }),
});

if (!login.ok) {
  console.error("No se pudo iniciar sesión:", await json(login));
  process.exit(1);
}

const { access_token: token } = await login.json();
const auth = { apikey: ANON, Authorization: `Bearer ${token}` };
console.log("Sesión iniciada como", email);

// ------------------------------------------------ rutas que espera el sitio
const consulta = await fetch(
  `${SB}/rest/v1/ads_public?select=slot,image_path,es_vitalicia&es_vitalicia=eq.true`,
  { headers: auth },
);
const filas = consulta.ok ? await consulta.json() : [];
const rutaDe = Object.fromEntries(filas.map((f) => [f.slot, f.image_path]));

let fallo = false;

for (const pieza of PIEZAS) {
  const ruta = rutaDe[pieza.slot];
  if (!ruta) {
    console.warn(`· ${pieza.slot}: no hay pieza vitalicia cargada en la base, se saltea.`);
    continue;
  }

  const cuerpo = await readFile(join(RAIZ, pieza.archivo));

  // upsert: se reemplaza el objeto existente en vez de crear uno nuevo, así la
  // fila de `ads` sigue apuntando a la misma ruta y no hay que tocar la base.
  const subida = await fetch(`${SB}/storage/v1/object/medios/${ruta}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: cuerpo,
  });

  if (subida.ok) {
    console.log(`· ${pieza.slot}: subido a medios/${ruta} (${Math.round(cuerpo.length / 1024)} KB)`);
  } else {
    fallo = true;
    console.error(`· ${pieza.slot}: falló →`, await json(subida));
  }
}

if (fallo) {
  console.error("\nAlgo no se subió. Si dice 'new row violates row-level security',");
  console.error("ese usuario no es admin: la política pide is_admin().");
  process.exit(1);
}

console.log("\nListo. Los avisos nuevos ya se sirven desde Supabase.");
console.log("El navegador puede tener la imagen vieja en caché: recargá con Ctrl+F5.");
