/* La importación de marcaciones.

   Dos cosas, las dos pensadas para el día en que llegue el captahuellas real:

     - importar el mismo archivo dos veces no duplica nada. El índice único sobre
       `referencia_externa` es el que lo impide, y cuando el archivo no trae
       identificador propio la función usa el SHA-256 de la línea original, así
       que la idempotencia no depende del aparato.

     - la línea original queda guardada tal cual. Es lo que va a permitir rehacer
       la interpretación —el orden de día y mes, la zona horaria, qué marca es
       entrada— sin volver a exportar del equipo.

   Corré:  node --test verificacion/marcaciones.mjs
*/

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { entrar, exigirEntorno, fn } from "./_comun.mjs";

exigirEntorno("PK_ANON", "PK_ADMIN_EMAIL", "PK_ADMIN_PASS");

const marca = Date.now();
const RELOJ = `RELOJ-${marca}`;
const contexto = { token: null, empleado: null };

// Un archivo de prueba con la forma que suelen tener estos aparatos: un id
// propio, el número de reloj, la fecha en día/mes/año y una letra para la marca.
const ARCHIVO = [
  `${marca}001;${RELOJ};05/01/2099 08:02:11;E`,
  `${marca}002;${RELOJ};05/01/2099 17:31:04;S`,
  `${marca}003;${RELOJ};06/01/2099 08:00:47;E`,
];

// El mismo mapeo que arma la pantalla del panel antes de mandar.
function filas() {
  return ARCHIVO.map((linea) => {
    const [ref, reloj, momento, tipo] = linea.split(";");
    const [fecha, hora] = momento.split(" ");
    const [dia, mes, anio] = fecha.split("/");

    return {
      referencia_externa: ref,
      codigo_reloj: reloj,
      momento: new Date(`${anio}-${mes}-${dia}T${hora}`).toISOString(),
      tipo: tipo === "S" ? "salida" : "entrada",
      bruto: linea,
    };
  });
}

before(async () => {
  contexto.token = await entrar(process.env.PK_ADMIN_EMAIL, process.env.PK_ADMIN_PASS);

  const r = await fn("empleados", {
    action: "crear",
    nombre: "Marcaciones",
    apellido: `Prueba ${marca}`,
    documento: `MARCA-${marca}`,
    codigo_reloj: RELOJ,
    salario_cents: 8000,
    salario_unidad: "dia",
  }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  contexto.empleado = r.datos.empleado;
});

after(async () => {
  await fn("empleados", {
    action: "retirar", id: contexto.empleado.id, motivo: "Empleado de prueba de verificación",
  }, contexto.token);
});

test("la primera importación entra completa y se asocia al empleado", async () => {
  const r = await fn("empleados", { action: "marcaciones_importar", filas: filas() }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.insertadas, 3);
  assert.equal(r.datos.repetidas, 0);
  assert.equal(r.datos.sin_empleado, 0, "el código de reloj tendría que resolver al empleado");
  assert.equal(r.datos.descartadas, 0);
});

test("la segunda importación del mismo archivo no duplica nada", async () => {
  const r = await fn("empleados", { action: "marcaciones_importar", filas: filas() }, contexto.token);

  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.insertadas, 0, "no tendría que entrar ninguna otra vez");
  assert.equal(r.datos.repetidas, 3);

  const listado = await fn("empleados", {
    action: "marcaciones_listar", empleado_id: contexto.empleado.id,
  }, contexto.token);

  assert.equal(listado.datos.marcaciones.length, 3, "tiene que haber tres, no seis");
});

test("la línea original quedó guardada tal cual vino", async () => {
  const r = await fn("empleados", {
    action: "marcaciones_listar", empleado_id: contexto.empleado.id,
  }, contexto.token);

  const guardadas = r.datos.marcaciones.map((m) => m.bruto).sort();
  assert.deepEqual(guardadas, [...ARCHIVO].sort());
});

test("sin identificador propio, el hash de la línea evita el duplicado igual", async () => {
  const sinRef = filas().map(({ referencia_externa, ...resto }) => ({
    ...resto,
    bruto: `sin-id ${resto.bruto}`,     // líneas distintas de las anteriores
  }));

  const primera = await fn("empleados", { action: "marcaciones_importar", filas: sinRef }, contexto.token);
  assert.equal(primera.datos.insertadas, 3, JSON.stringify(primera.datos));

  const segunda = await fn("empleados", { action: "marcaciones_importar", filas: sinRef }, contexto.token);
  assert.equal(segunda.datos.insertadas, 0, "el hash del bruto tendría que frenarlas");
  assert.equal(segunda.datos.repetidas, 3);
});

test("una marcación de alguien que no está en ningún legajo se guarda igual", async () => {
  // No se pierde el dato: se guarda sin empleado y se corrige el legajo después.
  const huerfana = [{
    referencia_externa: `${marca}-huerfana`,
    codigo_reloj: "NADIE-999",
    momento: new Date("2099-01-07T08:00:00").toISOString(),
    tipo: "entrada",
    bruto: `${marca}-huerfana;NADIE-999;07/01/2099 08:00:00;E`,
  }];

  const r = await fn("empleados", { action: "marcaciones_importar", filas: huerfana }, contexto.token);

  assert.equal(r.datos.insertadas, 1);
  assert.equal(r.datos.sin_empleado, 1);
});

test("una fecha ilegible se descarta y no rompe el resto del archivo", async () => {
  const mezcla = [
    {
      referencia_externa: `${marca}-mala`,
      codigo_reloj: RELOJ,
      momento: "no es una fecha",
      tipo: "entrada",
      bruto: `${marca}-mala;${RELOJ};??;E`,
    },
    {
      referencia_externa: `${marca}-buena`,
      codigo_reloj: RELOJ,
      momento: new Date("2099-01-08T08:00:00").toISOString(),
      tipo: "entrada",
      bruto: `${marca}-buena;${RELOJ};08/01/2099 08:00:00;E`,
    },
  ];

  const r = await fn("empleados", { action: "marcaciones_importar", filas: mezcla }, contexto.token);

  assert.equal(r.datos.insertadas, 1);
  assert.equal(r.datos.descartadas, 1);
});

test("la nómina no calcula horas con esto todavía", async () => {
  // El hueco está, pero vacío a propósito: sin el formato real del aparato,
  // cualquier fórmula sería una suposición sobre el dinero de otras personas.
  const semanas = await fn("nomina", { action: "semanas" }, contexto.token);
  assert.equal(semanas.status, 200);

  const conLineas = semanas.datos.semanas[0];
  if (!conLineas) return;

  const ver = await fn("nomina", { action: "semana_ver", id: conLineas.id }, contexto.token);
  for (const linea of ver.datos.lineas) {
    assert.equal(linea.horas_trabajadas, null, "horas_trabajadas todavía no se llena");
  }
});
