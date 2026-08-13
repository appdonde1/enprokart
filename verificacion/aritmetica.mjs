/* La aritmética del sueldo, sin red.

   Importa el módulo real que usan las Edge Functions (`_shared/dinero.ts`), no
   una copia: si probara una reimplementación, probaría el archivo equivocado.
   Node 22.18+ y 24 leen TypeScript quitando los tipos, sin compilar nada.

   Corré:  node --test verificacion/aritmetica.mjs
*/

import test from "node:test";
import assert from "node:assert/strict";

import {
  bonoCents,
  salarioSemanalCents,
  sumaCents,
  totalLineaCents,
  valorHoraCents,
} from "../supabase/functions/_shared/dinero.ts";

test("R$ 80 por día con jornada de 8 h da R$ 10,00 por hora, exacto", () => {
  assert.equal(valorHoraCents(8000, "dia", 8), 1000);
});

test("el punto flotante no se cuela en la conversión", () => {
  // 0,1 + 0,2 en reales: 10 + 20 centavos. En float da 0.30000000000000004.
  assert.notEqual(0.1 + 0.2, 0.3);   // el motivo por el que existe este módulo
  assert.equal(sumaCents([10, 20]), 30);

  // 80 / 3 no es exacto: tiene que redondearse una sola vez y no arrastrar cola.
  const porHora = valorHoraCents(8000, "dia", 3);
  assert.equal(porHora, 2667);
  assert.equal(Number.isInteger(porHora), true);
});

test("la deriva del float aparece al acumular, que es lo que hace una nómina", () => {
  /* Un redondeo suelto casi siempre coincide. Lo que no coincide es sumar mil
     líneas, que es exactamente lo que hace una nómina mes a mes: en reales el
     total se va 0,0000000000056 y sigue creciendo; en centavos enteros no se va
     nunca. */
  let enReales = 0;
  const enCentavos = [];
  for (let i = 0; i < 1000; i++) {
    enReales += 0.1 + 0.2;
    enCentavos.push(10, 20);
  }

  assert.notEqual(enReales, 300);
  assert.equal(sumaCents(enCentavos), 30000);
  assert.equal(Number.isInteger(sumaCents(enCentavos)), true);
});

test("una lista de sueldos suma igual que sumada a mano", () => {
  const sueldos = [8000, 12050, 999, 1, 45999, 33333];
  const aMano = 8000 + 12050 + 999 + 1 + 45999 + 33333;

  assert.equal(sumaCents(sueldos), aMano);
  assert.equal(sumaCents(sueldos), 100382);
  assert.equal(Number.isInteger(sumaCents(sueldos)), true);
});

test("un bono del 33 % sobre R$ 80 da lo mismo por dos caminos", () => {
  const base = 8000;

  const porBono = bonoCents(base, 33);
  const porTotal = totalLineaCents(base, 33, 0) - base;

  assert.equal(porBono, 2640);          // R$ 26,40
  assert.equal(porTotal, porBono);
  assert.equal(totalLineaCents(base, 33, 0), 10640);
});

test("el bono siempre sale entero: nunca queda una fracción de centavo", () => {
  /* El camino ingenuo devuelve 99,9 centavos, que no existe: hay que redondear.
     El del módulo devuelve un entero desde el principio, así que no hay ningún
     lugar donde alguien pueda olvidarse de redondear. */
  assert.equal(999 * (10 / 100), 99.9);
  assert.equal(Number.isInteger(999 * (10 / 100)), false);

  for (const [base, pct] of [[999, 10], [4999, 17], [8330, 33], [2035, 15], [1, 33]]) {
    assert.equal(Number.isInteger(bonoCents(base, pct)), true);
  }
});

test("porcentajes con decimales no pierden centavos", () => {
  assert.equal(bonoCents(8000, 12.5), 1000);
  assert.equal(bonoCents(999, 10), 100);        // 99,9 → 100, redondeo único
  assert.equal(bonoCents(8000, 0), 0);
  assert.equal(bonoCents(8000, null), 0);
});

test("el total resta el descuento y nunca queda en negativo", () => {
  assert.equal(totalLineaCents(8000, null, 1500), 6500);
  assert.equal(totalLineaCents(8000, 10, 1000), 7800);

  // Un descuento mayor que el sueldo es un error de carga, no una deuda.
  assert.equal(totalLineaCents(8000, null, 99999), 0);
});

test("el sueldo se lleva a la semana según su unidad", () => {
  // R$ 80 por día · 6 jornadas
  assert.equal(salarioSemanalCents(8000, "dia", 8), 48000);
  // R$ 10 por hora · 8 h · 6 jornadas
  assert.equal(salarioSemanalCents(1000, "hora", 8), 48000);
  // Los dos caminos coinciden: es el mismo sueldo dicho de dos maneras.
  assert.equal(
    salarioSemanalCents(8000, "dia", 8),
    salarioSemanalCents(valorHoraCents(8000, "dia", 8), "hora", 8),
  );

  assert.equal(salarioSemanalCents(48000, "semana", 8), 48000);
  assert.equal(salarioSemanalCents(240000, "mes", 8), 48000);
});

test("los valores rotos se vuelven cero, nunca NaN", () => {
  // Un NaN dentro de una suma de dinero contamina el total entero y no se nota
  // hasta el pago.
  assert.equal(sumaCents([100, undefined, null, "abc", 50]), 150);
  assert.equal(bonoCents(8000, Number("x")), 0);
  assert.equal(Number.isNaN(totalLineaCents("x", "y", "z")), false);
});
