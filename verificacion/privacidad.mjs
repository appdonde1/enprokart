/* Qué alcanza a leer cada clave por sí sola.

   Las tablas de personal guardan cédula, dirección, teléfono y sueldo. Ninguna
   tiene grant para `anon` ni para `authenticated`: el único camino es la Edge
   Function, que verifica el rol antes de devolver una fila. Acá se comprueba
   consultando PostgREST directo, sin función de por medio.

   Es la misma comprobación que en su momento hizo falta para `seats.held_by`:
   Supabase otorga permisos por defecto sobre las tablas nuevas del esquema
   público, y un grant por columnas se suma a ese permiso en vez de
   reemplazarlo. Si alguien agrega una tabla sin el `revoke`, esto lo encuentra.

   Corré:  node --test verificacion/privacidad.mjs
*/

import test, { before } from "node:test";
import assert from "node:assert/strict";

import { entrar, exigirEntorno, fn, leer } from "./_comun.mjs";

exigirEntorno("PK_ANON", "PK_ADMIN_EMAIL", "PK_ADMIN_PASS");

const CERRADAS = [
  "empleados",
  "marcaciones",
  "nomina_semanas",
  "nomina_lineas",
  "nomina_ajustes",
];

const sesion = { admin: null, mesero: null };

before(async () => {
  sesion.admin = await entrar(process.env.PK_ADMIN_EMAIL, process.env.PK_ADMIN_PASS);

  if (process.env.PK_MESERO_EMAIL && process.env.PK_MESERO_PASS) {
    sesion.mesero = await entrar(process.env.PK_MESERO_EMAIL, process.env.PK_MESERO_PASS);
  }
});

test("anon no lee ninguna tabla de personal", async () => {
  for (const tabla of CERRADAS) {
    const r = await leer(tabla, null);
    assert.notEqual(r.status, 200, `anon leyó ${tabla}: ${JSON.stringify(r.datos)}`);
  }
});

test("un admin autenticado tampoco las lee directo: solo por la función", async () => {
  // No es desconfianza del admin: es que la llave que tiene el navegador no
  // sirve para leer sueldos, y así una pestaña abierta no expone la nómina.
  for (const tabla of CERRADAS) {
    const r = await leer(tabla, sesion.admin);
    assert.notEqual(r.status, 200, `el admin leyó ${tabla} directo: ${JSON.stringify(r.datos)}`);
  }
});

test("el admin sí los recibe por la Edge Function", async () => {
  const r = await fn("empleados", { action: "listar" }, sesion.admin);
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.ok(Array.isArray(r.datos.empleados));
});

test("un mesero autenticado no lee las tablas ni pasa por la función", { skip: !process.env.PK_MESERO_EMAIL }, async () => {
  for (const tabla of CERRADAS) {
    const r = await leer(tabla, sesion.mesero);
    assert.notEqual(r.status, 200, `el mesero leyó ${tabla}`);
  }

  const porFuncion = await fn("empleados", { action: "listar" }, sesion.mesero);
  assert.equal(porFuncion.status, 403);
});

test("anon no lee las horas de jornada, pero sí las redes", async () => {
  // `site_settings` quedó abierta a anon cuando solo tenía enlaces a redes. Al
  // sumarle un parámetro de nómina se cerró por columna, como `seats`.
  const redes = await leer("site_settings", null, "select=instagram_url,tiktok_url,whatsapp_url&limit=1");
  assert.equal(redes.status, 200, "el sitio público necesita leer las redes");

  const jornada = await leer("site_settings", null, "select=horas_jornada&limit=1");
  assert.notEqual(jornada.status, 200, "anon no tendría que ver horas_jornada");
});

test("el código de administrador no es legible desde el navegador por nadie", async () => {
  const r = await leer("staff_profiles", sesion.admin, "select=admin_code&limit=1");
  assert.notEqual(r.status, 200, "admin_code se compara en el servidor, no se lee");
});

test("los catálogos sí son legibles para un admin: no tienen dato personal", async () => {
  for (const tabla of ["areas", "credenciales"]) {
    const r = await leer(tabla, sesion.admin, "select=id,nombre&limit=1");
    assert.equal(r.status, 200, `el admin tendría que leer ${tabla}: ${JSON.stringify(r.datos)}`);
  }
});

test("anon tampoco lee los catálogos", async () => {
  for (const tabla of ["areas", "credenciales"]) {
    const r = await leer(tabla, null, "select=id,nombre&limit=1");
    const vacio = r.status !== 200 || (Array.isArray(r.datos) && r.datos.length === 0);
    assert.ok(vacio, `anon leyó ${tabla}: ${JSON.stringify(r.datos)}`);
  }
});
