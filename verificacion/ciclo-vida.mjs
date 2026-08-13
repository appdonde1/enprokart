/* El ciclo de vida de un legajo.

   Lo que se comprueba es que ningún camino borre a un empleado. Retirarlo lo
   saca de la lista activa; reingresarlo lo devuelve con el mismo código y el
   mismo historial. Borrarlo perdería el registro de quién trabajó y cuánto se le
   pagó, que es justamente lo que hay que poder auditar.

   Corré:  node --test verificacion/ciclo-vida.mjs
*/

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { entrar, exigirEntorno, fn } from "./_comun.mjs";

exigirEntorno("PK_ANON", "PK_ADMIN_EMAIL", "PK_ADMIN_PASS");

const contexto = { token: null, empleado: null };
const marca = Date.now();

before(async () => {
  contexto.token = await entrar(process.env.PK_ADMIN_EMAIL, process.env.PK_ADMIN_PASS);

  const r = await fn("empleados", {
    action: "crear",
    nombre: "Ciclo",
    apellido: `Vida ${marca}`,
    documento: `CICLO-${marca}`,
    salario_cents: 8000,
    salario_unidad: "dia",
    dias_libres: ["lunes", "martes"],
  }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  contexto.empleado = r.datos.empleado;
});

after(async () => {
  await fn("empleados", {
    action: "retirar", id: contexto.empleado.id, motivo: "Empleado de prueba de verificación",
  }, contexto.token);
});

test("el código es correlativo y legible", () => {
  assert.match(contexto.empleado.codigo, /^EMP-\d{3,}$/);
});

test("los días libres se guardan tal cual se marcaron", () => {
  assert.deepEqual([...contexto.empleado.dias_libres].sort(), ["lunes", "martes"]);
});

test("aparece en la lista activa", async () => {
  const r = await fn("empleados", { action: "listar" }, contexto.token);
  const encontrado = r.datos.empleados.find((e) => e.id === contexto.empleado.id);

  assert.ok(encontrado, "el empleado nuevo tiene que estar en la lista activa");
  assert.equal(encontrado.estado, "activo");
});

test("el buscador lo encuentra por cédula", async () => {
  const r = await fn("empleados", { action: "listar", buscar: `CICLO-${marca}` }, contexto.token);
  assert.equal(r.datos.empleados.length, 1);
  assert.equal(r.datos.empleados[0].id, contexto.empleado.id);
});

test("retirar exige motivo", async () => {
  const r = await fn("empleados", { action: "retirar", id: contexto.empleado.id, motivo: "" }, contexto.token);
  assert.equal(r.status, 400, JSON.stringify(r.datos));
});

test("retirado sale de la lista activa y aparece en Retirados", async () => {
  const retirar = await fn("empleados", {
    action: "retirar", id: contexto.empleado.id, motivo: "Prueba de ciclo de vida",
  }, contexto.token);
  assert.equal(retirar.status, 200, JSON.stringify(retirar.datos));

  const activos = await fn("empleados", { action: "listar" }, contexto.token);
  assert.equal(activos.datos.empleados.find((e) => e.id === contexto.empleado.id), undefined);

  const conRetirados = await fn("empleados", { action: "listar", incluir_retirados: true }, contexto.token);
  const encontrado = conRetirados.datos.empleados.find((e) => e.id === contexto.empleado.id);

  assert.ok(encontrado, "tiene que seguir estando, atenuado, entre los retirados");
  assert.equal(encontrado.estado, "retirado");
  assert.equal(encontrado.motivo_retiro, "Prueba de ciclo de vida");
  assert.ok(encontrado.fecha_retiro, "un retiro sin fecha no sirve para reconstruir un pago");
});

test("reingresar lo devuelve conservando su código", async () => {
  const r = await fn("empleados", { action: "reingresar", id: contexto.empleado.id }, contexto.token);
  assert.equal(r.status, 200, JSON.stringify(r.datos));

  const activos = await fn("empleados", { action: "listar" }, contexto.token);
  const encontrado = activos.datos.empleados.find((e) => e.id === contexto.empleado.id);

  assert.ok(encontrado, "tiene que volver a la lista activa");
  assert.equal(encontrado.codigo, contexto.empleado.codigo, "el código no cambia al reingresar");
  assert.equal(encontrado.fecha_retiro, null);
  assert.equal(encontrado.motivo_retiro, null);
  assert.equal(encontrado.fecha_ingreso, contexto.empleado.fecha_ingreso);
});

test("la ficha trae todos los datos y el legajo sigue completo", async () => {
  const r = await fn("empleados", { action: "ficha", id: contexto.empleado.id }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  for (const campo of [
    "codigo", "nombre", "apellido", "documento", "fecha_ingreso",
    "dias_libres", "salario_cents", "salario_unidad", "estado",
  ]) {
    assert.ok(campo in r.datos.empleado, `falta ${campo} en la ficha`);
  }
  assert.ok(r.datos.horas_jornada >= 1, "la ficha necesita la jornada para el valor hora");
});

test("no existe ninguna acción que borre un legajo", async () => {
  for (const accion of ["borrar", "eliminar", "delete"]) {
    const r = await fn("empleados", { action: accion, id: contexto.empleado.id }, contexto.token);
    assert.equal(r.status, 400, `${accion} no tendría que existir`);
    assert.match(r.datos.error, /desconocida/i);
  }

  const sigue = await fn("empleados", { action: "ficha", id: contexto.empleado.id }, contexto.token);
  assert.equal(sigue.status, 200, "el legajo sigue existiendo");
});
