/* El reporte semanal, sin red.

   Prueba el módulo que usa la Edge Function, no una copia: importa
   `_shared/reporte.ts` directo, igual que `aritmetica.mjs` con `dinero.ts`.
   Por eso hace falta Node 22.18 o más nuevo.

   Lo que se prueba acá es lo único del reporte que puede equivocarse en
   silencio: qué semana cubre. Los totales los da la base y Asaas; el rango lo
   calculamos nosotros, y si se corre un día el reporte miente sin avisar. */

import test from "node:test";
import assert from "node:assert/strict";

import {
  armarMensajeReporte,
  diasParaExtracto,
  rangoSemana,
} from "../supabase/functions/_shared/reporte.ts";

/* El salón está en Boa Vista y la administración piensa en hora de Venezuela:
   los dos son UTC-4 y ninguno tiene horario de verano. El cron corre a las
   15:00 UTC, que son las 11:00 de allá. */

test("un lunes a las 11:00 locales, la semana va de lunes a lunes", () => {
  // 2026-08-17 15:00 UTC = lunes 11:00 en UTC-4
  const { desde, hasta } = rangoSemana(new Date("2026-08-17T15:00:00Z"));

  // Medianoche local del lunes es 04:00 UTC.
  assert.equal(hasta.toISOString(), "2026-08-17T04:00:00.000Z");
  assert.equal(desde.toISOString(), "2026-08-10T04:00:00.000Z");

  const dias = (hasta.getTime() - desde.getTime()) / 86_400_000;
  assert.equal(dias, 7, "la ventana tiene que ser de siete días exactos");
});

test("el bloque no incluye las ventas de esa misma mañana", () => {
  // Una venta a las 09:00 locales del lunes cae DESPUÉS del corte, así que
  // entra en el reporte de la semana siguiente y no se cuenta dos veces.
  const { hasta } = rangoSemana(new Date("2026-08-17T15:00:00Z"));
  const ventaDelLunesTemprano = new Date("2026-08-17T13:00:00Z");
  assert.ok(ventaDelLunesTemprano > hasta);
});

test("domingo a la noche local todavía es la semana anterior", () => {
  /* La trampa del huso: 2026-08-17T02:00Z ya es lunes en UTC, pero en UTC-4
     son las 22:00 del domingo. Si el cálculo usara UTC crudo, saltaría una
     semana entera y el reporte saldría vacío. */
  const { desde, hasta } = rangoSemana(new Date("2026-08-17T02:00:00Z"));

  assert.equal(hasta.toISOString(), "2026-08-10T04:00:00.000Z");
  assert.equal(desde.toISOString(), "2026-08-03T04:00:00.000Z");
});

test("desde un miércoles, el corte sigue siendo el lunes de esa semana", () => {
  const { desde, hasta } = rangoSemana(new Date("2026-08-19T18:00:00Z"));
  assert.equal(hasta.toISOString(), "2026-08-17T04:00:00.000Z");
  assert.equal(desde.toISOString(), "2026-08-10T04:00:00.000Z");
});

test("al extracto se le piden siete días locales, de lunes a domingo", () => {
  /* Asaas filtra por día calendario, no por instante. El último día pedido
     tiene que ser el domingo: si se pidiera hasta el lunes, entrarían
     movimientos que pertenecen al reporte siguiente y la plata se contaría
     dos veces. */
  const { desde, hasta } = rangoSemana(new Date("2026-08-17T15:00:00Z"));
  const dias = diasParaExtracto(desde, hasta);

  assert.equal(dias.desde, "2026-08-10", "arranca el lunes");
  assert.equal(dias.hasta, "2026-08-16", "termina el domingo, no el lunes");
});

test("el mensaje muestra los cuatro números pedidos, en reales", () => {
  const texto = armarMensajeReporte({
    eventoNombre: "Jorge Guerrero en vivo",
    desde: new Date("2026-08-10T04:00:00Z"),
    hasta: new Date("2026-08-17T04:00:00Z"),
    semana: { entradas: 12, pagadoCents: 1_440_000, recibidoCents: 1_437_624, cortesias: 3 },
    acumulado: { entradas: 45, pagadoCents: 5_400_000, recibidoCents: 5_391_090, cortesias: 8 },
  });

  assert.match(texto, /12/, "entradas vendidas de la semana");
  assert.match(texto, /R\$ 14\.400,00/, "total pagado en formato brasileño");
  assert.match(texto, /R\$ 14\.376,24/, "total recibido neto");
  assert.match(texto, /3/, "cortesías de la semana");

  assert.match(texto, /45/, "entradas acumuladas");
  assert.match(texto, /R\$ 54\.000,00/, "pagado acumulado");
  assert.match(texto, /Jorge Guerrero en vivo/);
});

test("una semana sin ventas no rompe ni miente", () => {
  const texto = armarMensajeReporte({
    eventoNombre: "Jorge Guerrero en vivo",
    desde: new Date("2026-08-10T04:00:00Z"),
    hasta: new Date("2026-08-17T04:00:00Z"),
    semana: { entradas: 0, pagadoCents: 0, recibidoCents: 0, cortesias: 0 },
    acumulado: { entradas: 45, pagadoCents: 5_400_000, recibidoCents: 5_391_090, cortesias: 8 },
  });

  assert.match(texto, /R\$ 0,00/);
  // El acumulado tiene que seguir apareciendo aunque la semana esté vacía.
  assert.match(texto, /R\$ 54\.000,00/);
});

test("si Asaas no responde, el reporte lo dice en vez de informar cero", () => {
  /* Un cero se lee como «no se vendió nada» y es una mentira que hace tomar
     decisiones. La ausencia del dato tiene que verse como ausencia. */
  const texto = armarMensajeReporte({
    eventoNombre: "Jorge Guerrero en vivo",
    desde: new Date("2026-08-10T04:00:00Z"),
    hasta: new Date("2026-08-17T04:00:00Z"),
    semana: { entradas: 12, pagadoCents: 1_440_000, recibidoCents: null, cortesias: 3 },
    acumulado: { entradas: 45, pagadoCents: 5_400_000, recibidoCents: null, cortesias: 8 },
  });

  assert.match(texto, /no disponible/);
  assert.doesNotMatch(texto, /R\$ 0,00/, "un cero acá sería engañoso");
  // Lo que sí sabemos —entradas y facturado— tiene que seguir estando.
  assert.match(texto, /R\$ 14\.400,00/);
});

test("el recibido puede ser negativo si en la semana hubo más reembolsos que ventas", () => {
  /* Pasa de verdad: una compra tardía que el webhook devuelve deja la comisión
     como pérdida. El reporte tiene que mostrarlo, no esconderlo en un cero. */
  const texto = armarMensajeReporte({
    eventoNombre: "Jorge Guerrero en vivo",
    desde: new Date("2026-08-10T04:00:00Z"),
    hasta: new Date("2026-08-17T04:00:00Z"),
    semana: { entradas: 0, pagadoCents: 0, recibidoCents: -198, cortesias: 0 },
    acumulado: { entradas: 45, pagadoCents: 5_400_000, recibidoCents: 5_391_090, cortesias: 8 },
  });

  assert.match(texto, /-\s?R\$ 1,98|R\$ -1,98/);
});
