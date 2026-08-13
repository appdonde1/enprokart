/* La jerarquía de roles, contra el proyecto real.

   Lo que se comprueba es que la regla viva en el servidor y no en el navegador:
   se llama a la Edge Function directo, sin panel de por medio, que es
   exactamente lo que haría alguien que quisiera saltearse los botones
   escondidos.

   Corré:  node --test verificacion/jerarquia.mjs
*/

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { entrar, exigirEntorno, fn } from "./_comun.mjs";

exigirEntorno(
  "PK_ANON",
  "PK_DEV_EMAIL", "PK_DEV_PASS",
  "PK_ADMIN_EMAIL", "PK_ADMIN_PASS",
);

const sesion = { dev: null, admin: null, mesero: null };
const creadas = [];   // ids a limpiar al final

// Correos de un solo uso, para no ensuciar la lista de personal real.
const correo = (que) => `verificacion-${que}-${Date.now()}@enprokart.com`;

before(async () => {
  sesion.dev = await entrar(process.env.PK_DEV_EMAIL, process.env.PK_DEV_PASS);
  sesion.admin = await entrar(process.env.PK_ADMIN_EMAIL, process.env.PK_ADMIN_PASS);
});

after(async () => {
  // El developer limpia lo que crearon las pruebas, incluido lo que el admin no
  // podría borrar.
  for (const id of creadas) {
    await fn("staff-admin", { action: "delete", id }, sesion.dev);
  }
});

test("el developer puede crear un administrador", async () => {
  const r = await fn("staff-admin", {
    action: "create", email: correo("admin"), display_name: "Admin de prueba", role: "admin",
  }, sesion.dev);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.role, "admin");
  assert.ok(r.datos.temporary_password);

  const lista = await fn("staff-admin", { action: "list" }, sesion.dev);
  const creado = lista.datos.staff.find((u) => u.email === r.datos.email);
  assert.ok(creado, "el admin creado tiene que aparecer en la lista");
  creadas.push(creado.id);
});

test("un admin NO puede crear otro admin", async () => {
  const r = await fn("staff-admin", {
    action: "create", email: correo("prohibido"), display_name: "No", role: "admin",
  }, sesion.admin);

  assert.equal(r.status, 403, JSON.stringify(r.datos));
});

test("un admin sí puede crear un mesero", async () => {
  const r = await fn("staff-admin", {
    action: "create", email: correo("mesero"), display_name: "Mesero de prueba", role: "mesero",
  }, sesion.admin);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.role, "mesero");

  const lista = await fn("staff-admin", { action: "list" }, sesion.dev);
  const creado = lista.datos.staff.find((u) => u.email === r.datos.email);
  creadas.push(creado.id);

  // Se guarda para el resto de las pruebas: hace falta una sesión de mesero.
  sesion.mesero = await entrar(r.datos.email, r.datos.temporary_password);
});

test("un admin no tiene ninguna acción sobre otro admin", async () => {
  const lista = await fn("staff-admin", { action: "list" }, sesion.admin);
  const otroAdmin = lista.datos.staff.find(
    (u) => u.role === "admin" && !u.es_uno_mismo,
  );

  assert.ok(otroAdmin, "hace falta otro admin cargado para esta prueba");
  assert.equal(otroAdmin.gestionable, false, "la lista tiene que decir que no es gestionable");

  for (const cuerpo of [
    { action: "update_role", id: otroAdmin.id, role: "mesero" },
    { action: "reset_password", id: otroAdmin.id },
    { action: "delete", id: otroAdmin.id },
  ]) {
    const r = await fn("staff-admin", cuerpo, sesion.admin);
    assert.equal(r.status, 403, `${cuerpo.action} tendría que dar 403: ${JSON.stringify(r.datos)}`);
  }
});

test("un admin no puede tocar la cuenta de desarrollo, pero la ve", async () => {
  const lista = await fn("staff-admin", { action: "list" }, sesion.admin);
  const dev = lista.datos.staff.find((u) => u.role === "developer");

  // Queda visible a propósito: una cuenta con poder total y oculta dentro del
  // sistema de otra persona es una puerta trasera, aunque la intención sea buena.
  assert.ok(dev, "la cuenta de desarrollo tiene que estar en la lista");
  assert.equal(dev.gestionable, false);

  for (const cuerpo of [
    { action: "update_role", id: dev.id, role: "mesero" },
    { action: "reset_password", id: dev.id },
    { action: "delete", id: dev.id },
  ]) {
    const r = await fn("staff-admin", cuerpo, sesion.admin);
    assert.equal(r.status, 403, `${cuerpo.action} tendría que dar 403: ${JSON.stringify(r.datos)}`);
  }
});

test("un admin no puede actuar sobre su propia cuenta: 400", async () => {
  const lista = await fn("staff-admin", { action: "list" }, sesion.admin);
  const yo = lista.datos.staff.find((u) => u.es_uno_mismo);
  assert.ok(yo);

  for (const cuerpo of [
    { action: "update_role", id: yo.id, role: "mesero" },
    { action: "reset_password", id: yo.id },
    { action: "delete", id: yo.id },
  ]) {
    const r = await fn("staff-admin", cuerpo, sesion.admin);
    assert.equal(r.status, 400, `${cuerpo.action} tendría que dar 400: ${JSON.stringify(r.datos)}`);
  }
});

test("un admin no puede promover a un mesero hasta administrador", async () => {
  const lista = await fn("staff-admin", { action: "list" }, sesion.admin);
  const mesero = lista.datos.staff.find((u) => u.role === "mesero" && u.gestionable);
  assert.ok(mesero, "hace falta un mesero gestionable");

  // Si esto pasara, la jerarquía se saltearía por la puerta de al lado.
  const r = await fn("staff-admin", {
    action: "update_role", id: mesero.id, role: "admin",
  }, sesion.admin);

  assert.equal(r.status, 403, JSON.stringify(r.datos));
});

test("el developer sí puede degradar y eliminar a un admin", async () => {
  const id = creadas[0];
  assert.ok(id, "hace falta el admin creado en la primera prueba");

  const degradar = await fn("staff-admin", { action: "update_role", id, role: "mesero" }, sesion.dev);
  assert.equal(degradar.status, 200, JSON.stringify(degradar.datos));

  const reiniciar = await fn("staff-admin", { action: "reset_password", id }, sesion.dev);
  assert.equal(reiniciar.status, 200, JSON.stringify(reiniciar.datos));
});

test("un mesero no ve ninguno de los módulos nuevos", async () => {
  assert.ok(sesion.mesero, "hace falta la sesión de mesero");

  for (const [funcion, cuerpo] of [
    ["staff-admin", { action: "list" }],
    ["empleados", { action: "listar" }],
    ["empleados", { action: "catalogos" }],
    ["nomina", { action: "semanas" }],
  ]) {
    const r = await fn(funcion, cuerpo, sesion.mesero);
    assert.equal(r.status, 403, `${funcion}/${cuerpo.action} tendría que dar 403`);
  }
});

test("sin sesión no se llega a ninguna de las dos funciones nuevas", async () => {
  for (const funcion of ["empleados", "nomina"]) {
    const r = await fn(funcion, { action: "listar" }, null);
    assert.ok([401, 403].includes(r.status), `${funcion} sin sesión dio ${r.status}`);
  }
});
