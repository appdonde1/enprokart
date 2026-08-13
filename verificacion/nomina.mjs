/* La nómina: motivo obligatorio, código de administrador y semanas que no se
   reescriben.

   Las tres cosas que tienen que ser verdad para que el registro sirva como
   registro:
     - un ajuste sin motivo no entra;
     - uno sin el código correcto no entra, aunque haya sesión de admin;
     - cerrar una semana congela sus números, y cambiar el sueldo del legajo
       después no la toca.

   Corré:  node --test verificacion/nomina.mjs
*/

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { entrar, exigirEntorno, fn } from "./_comun.mjs";

exigirEntorno("PK_ANON", "PK_ADMIN_EMAIL", "PK_ADMIN_PASS", "PK_ADMIN_CODE");

const CODIGO = process.env.PK_ADMIN_CODE;
const contexto = { token: null, empleado: null, semana: null, linea: null };

// Una semana lejos en el futuro, para no chocar con ninguna real.
const DESDE = "2099-01-05";
const HASTA = "2099-01-11";

before(async () => {
  contexto.token = await entrar(process.env.PK_ADMIN_EMAIL, process.env.PK_ADMIN_PASS);

  const empleado = await fn("empleados", {
    action: "crear",
    nombre: "Prueba",
    apellido: `Nómina ${Date.now()}`,
    documento: `TEST-${Date.now()}`,
    salario_cents: 8000,        // R$ 80 por día
    salario_unidad: "dia",
  }, contexto.token);

  assert.equal(empleado.status, 200, JSON.stringify(empleado.datos));
  contexto.empleado = empleado.datos.empleado;

  const semana = await fn("nomina", { action: "semana_abrir", desde: DESDE, hasta: HASTA }, contexto.token);
  assert.equal(semana.status, 200, JSON.stringify(semana.datos));
  contexto.semana = semana.datos.semana;

  const ver = await fn("nomina", { action: "semana_ver", id: contexto.semana.id }, contexto.token);
  contexto.linea = ver.datos.lineas.find((l) => l.empleado_id === contexto.empleado.id);
  assert.ok(contexto.linea, "el empleado de prueba tiene que tener línea en la semana");
});

after(async () => {
  // El empleado no se borra —ningún camino borra un legajo— pero se retira para
  // que no ensucie la lista activa.
  if (contexto.empleado) {
    await fn("empleados", {
      action: "retirar", id: contexto.empleado.id, motivo: "Empleado de prueba de verificación",
    }, contexto.token);
  }
});

test("la línea nace con el sueldo del legajo llevado a la semana", () => {
  // R$ 80 por día · 6 jornadas = R$ 480,00
  assert.equal(contexto.linea.salario_base_cents, 48000);
  assert.equal(contexto.linea.total_cents, 48000);
});

test("un ajuste sin motivo se rechaza", async () => {
  const r = await fn("nomina", {
    action: "linea_ajustar", linea_id: contexto.linea.id,
    tipo: "descuento", valor_cents: 1000, motivo: "", admin_code: CODIGO,
  }, contexto.token);

  assert.equal(r.status, 400, JSON.stringify(r.datos));
});

test("un ajuste sin el código de administrador se rechaza con 403", async () => {
  const sinCodigo = await fn("nomina", {
    action: "linea_ajustar", linea_id: contexto.linea.id,
    tipo: "descuento", valor_cents: 1000, motivo: "Prueba sin código",
  }, contexto.token);

  assert.equal(sinCodigo.status, 403, JSON.stringify(sinCodigo.datos));
  assert.equal(sinCodigo.datos.bad_code, true);

  const codigoMalo = await fn("nomina", {
    action: "linea_ajustar", linea_id: contexto.linea.id,
    tipo: "descuento", valor_cents: 1000, motivo: "Prueba con código incorrecto",
    admin_code: CODIGO === "000" ? "999" : "000",
  }, contexto.token);

  assert.equal(codigoMalo.status, 403, JSON.stringify(codigoMalo.datos));
  assert.equal(codigoMalo.datos.bad_code, true);
});

test("con el código correcto el ajuste entra y queda registrado con quién y cuándo", async () => {
  const r = await fn("nomina", {
    action: "linea_ajustar", linea_id: contexto.linea.id,
    tipo: "descuento", valor_cents: 1000,
    motivo: "Descuento de prueba de verificación", admin_code: CODIGO,
  }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.linea.descuento_cents, 1000);
  assert.equal(r.datos.linea.total_cents, 47000);

  const ver = await fn("nomina", { action: "semana_ver", id: contexto.semana.id }, contexto.token);
  const linea = ver.datos.lineas.find((l) => l.id === contexto.linea.id);
  const ajuste = linea.ajustes[0];

  assert.ok(ajuste, "el ajuste tiene que quedar en el historial");
  assert.equal(ajuste.tipo, "descuento");
  assert.equal(ajuste.motivo, "Descuento de prueba de verificación");
  assert.ok(ajuste.hecho_en, "tiene que decir cuándo");
  assert.notEqual(ajuste.quien, "sin registrar", "tiene que decir quién");
});

test("el bono se calcula sobre el sueldo de la línea, en enteros", async () => {
  const r = await fn("nomina", {
    action: "linea_ajustar", linea_id: contexto.linea.id,
    tipo: "bono", porcentaje: 33,
    motivo: "Bono de prueba de verificación", admin_code: CODIGO,
  }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.linea.bono_cents, 15840);          // 33 % de R$ 480,00
  assert.equal(r.datos.linea.total_cents, 48000 + 15840 - 1000);
  assert.equal(Number.isInteger(r.datos.linea.total_cents), true);
});

test("los ajustes se acumulan: ninguno reemplaza al anterior", async () => {
  const ver = await fn("nomina", { action: "semana_ver", id: contexto.semana.id }, contexto.token);
  const linea = ver.datos.lineas.find((l) => l.id === contexto.linea.id);

  assert.equal(linea.ajustes.length, 2, "tienen que estar el descuento y el bono");
});

test("cerrar la semana copia la identidad y congela los números", async () => {
  const cerrar = await fn("nomina", {
    action: "semana_cerrar", id: contexto.semana.id, admin_code: CODIGO,
  }, contexto.token);

  assert.equal(cerrar.status, 200, JSON.stringify(cerrar.datos));

  const ver = await fn("nomina", { action: "semana_ver", id: contexto.semana.id }, contexto.token);
  const linea = ver.datos.lineas.find((l) => l.id === contexto.linea.id);

  assert.equal(ver.datos.semana.estado, "cerrada");
  assert.equal(linea.empleado_codigo, contexto.empleado.codigo);
  assert.ok(linea.empleado_nombre.includes("Prueba"));
  assert.equal(linea.empleado_documento, contexto.empleado.documento);
});

test("cambiarle el sueldo al empleado NO altera la semana cerrada", async () => {
  const antes = await fn("nomina", { action: "semana_ver", id: contexto.semana.id }, contexto.token);
  const totalAntes = antes.datos.lineas.find((l) => l.id === contexto.linea.id).total_cents;

  // El aumento entra en el legajo…
  const subir = await fn("empleados", {
    action: "editar", id: contexto.empleado.id,
    nombre: "Prueba", apellido: contexto.empleado.apellido,
    documento: contexto.empleado.documento,
    salario_cents: 50000, salario_unidad: "dia",
  }, contexto.token);
  assert.equal(subir.status, 200, JSON.stringify(subir.datos));

  // …y la semana cerrada sigue diciendo exactamente lo que se pagó.
  const despues = await fn("nomina", { action: "semana_ver", id: contexto.semana.id }, contexto.token);
  const linea = despues.datos.lineas.find((l) => l.id === contexto.linea.id);

  assert.equal(linea.total_cents, totalAntes);
  assert.equal(linea.salario_base_cents, 48000);
});

test("una semana cerrada no acepta más ajustes", async () => {
  const r = await fn("nomina", {
    action: "linea_ajustar", linea_id: contexto.linea.id,
    tipo: "descuento", valor_cents: 500,
    motivo: "Intento sobre semana cerrada", admin_code: CODIGO,
  }, contexto.token);

  assert.equal(r.status, 409, JSON.stringify(r.datos));
});

test("no existe ninguna acción para editar ni borrar un ajuste", async () => {
  for (const accion of ["ajuste_editar", "ajuste_borrar", "linea_borrar"]) {
    const r = await fn("nomina", { action: accion, id: contexto.linea.id }, contexto.token);
    assert.equal(r.status, 400, `${accion} no tendría que existir`);
    assert.match(r.datos.error, /desconocida/i);
  }
});
