/* La aritmética del sueldo, en un solo lugar.

   Todo entra y sale en centavos enteros. `0.1 + 0.2` no da `0.3` ni en
   JavaScript ni en Postgres, así que un sueldo nunca se representa como
   `80.00`: se representa como `8000`. Se redondea una sola vez, al final, y
   solo al convertir o al mostrar.

   Misma regla que `orders.amount_cents` en la venta de entradas. */

export type SalarioUnidad = "hora" | "dia" | "semana" | "mes";

// Cuántas jornadas tiene cada unidad. Una semana laboral son 6 días y un mes,
// 30: son las que usa el local para hablar de sueldos, no un promedio del
// calendario.
const JORNADAS: Record<SalarioUnidad, number> = {
  hora: 0,
  dia: 1,
  semana: 6,
  mes: 30,
};

export function esUnidad(valor: unknown): valor is SalarioUnidad {
  return valor === "hora" || valor === "dia" || valor === "semana" || valor === "mes";
}

/* Valor de la hora, en centavos.

   R$ 80 por día con jornada de 8 h da exactamente R$ 10,00: 8000 / 8 = 1000,
   sin centavos perdidos. Cuando la división no es exacta el resto se redondea
   una única vez acá, y no en cada línea de la nómina. */
export function valorHoraCents(
  salarioCents: number,
  unidad: SalarioUnidad,
  horasJornada: number,
): number {
  const base = enteroSeguro(salarioCents);
  if (unidad === "hora") return base;

  const horas = JORNADAS[unidad] * Math.max(1, Math.trunc(horasJornada));
  if (horas <= 0) return 0;
  return Math.round(base / horas);
}

/* Sueldo llevado a la semana, en centavos. Es la base de una línea de nómina. */
export function salarioSemanalCents(
  salarioCents: number,
  unidad: SalarioUnidad,
  horasJornada: number,
): number {
  const base = enteroSeguro(salarioCents);
  const horas = Math.max(1, Math.trunc(horasJornada));

  switch (unidad) {
    case "hora":
      return base * JORNADAS.semana * horas;
    case "dia":
      return base * JORNADAS.semana;
    case "semana":
      return base;
    case "mes":
      // Un mes son 30 jornadas y una semana 6: el mes trae cinco semanas de
      // trabajo. Se redondea una sola vez.
      return Math.round((base * JORNADAS.semana) / JORNADAS.mes);
  }
}

/* Bono porcentual, en centavos.

   No multiplica por un decimal. El porcentaje se pasa a puntos básicos enteros
   (33 % → 3300) y recién ahí se divide, para que el redondeo ocurra una vez y
   sobre enteros. `8000 * 3300 / 10000` da 2640 exacto; `8000 * 0.33` da
   2640.0000000000005, que es la clase de resto que después no cuadra. */
export function bonoCents(baseCents: number, pct: number | null | undefined): number {
  if (pct === null || pct === undefined) return 0;

  const puntosBasicos = Math.round(Number(pct) * 100);
  if (!Number.isFinite(puntosBasicos) || puntosBasicos <= 0) return 0;

  return Math.round((enteroSeguro(baseCents) * puntosBasicos) / 10000);
}

/* Total de una línea: base + bono - descuento, en centavos.

   No baja de cero: una nómina en negativo no es un pago, es un error de carga,
   y prefiere verse como cero antes que como una deuda del empleado. */
export function totalLineaCents(
  baseCents: number,
  pct: number | null | undefined,
  descuentoCents: number,
): number {
  const base = enteroSeguro(baseCents);
  const bono = bonoCents(base, pct);
  const descuento = enteroSeguro(descuentoCents);
  return Math.max(0, base + bono - descuento);
}

/* Suma de centavos. Existe para que nadie tenga que acordarse de no usar
   `reduce` sobre reales convertidos a moneda. */
export function sumaCents(valores: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of valores) total += enteroSeguro(v);
  return total;
}

/* Un valor que llega del navegador o de la base y tiene que ser centavos.
   Cualquier cosa rara se convierte en 0 antes que en NaN: un NaN dentro de una
   suma de dinero contamina el total entero y no se nota hasta el pago. */
export function enteroSeguro(valor: unknown): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

/* Solo para mensajes y registros del servidor. El panel formatea con
   `PanelBase.plata()`. */
export function comoPlata(cents: number): string {
  return `R$ ${(enteroSeguro(cents) / 100).toFixed(2).replace(".", ",")}`;
}
