/* El reporte semanal: la parte que no toca la red.
 *
 * Vive aparte de la Edge Function a propósito. Lo único del reporte que puede
 * equivocarse en silencio es el rango de fechas —si se corre un día, los
 * números salen mal pero verosímiles, y nadie lo nota—, así que esa cuenta se
 * prueba sin red desde `verificacion/reporte.mjs`.
 *
 * Todo el dinero entra y sale en centavos enteros, igual que en el resto del
 * sistema. Se convierte a reales una sola vez, al escribir el mensaje.
 */

/* El salón está en Boa Vista y la administración piensa en hora de Venezuela.
   Los dos son UTC-4 y ninguno tiene horario de verano, así que un número fijo
   alcanza y no hace falta arrastrar una base de husos horarios. */
const OFFSET_HORAS = -4;
const UNA_HORA = 3_600_000;
const UN_DIA = 86_400_000;

export type Totales = {
  entradas: number;
  pagadoCents: number;
  /* `null` cuando el extracto de Asaas no se pudo leer. Un reporte que dice
     "no disponible" es útil; uno que informa cero recaudado porque falló una
     llamada hace tomar decisiones sobre una mentira. */
  recibidoCents: number | null;
  cortesias: number;
};

export type DatosReporte = {
  eventoNombre: string;
  desde: Date;
  hasta: Date;
  semana: Totales;
  acumulado: Totales;
};

/* La semana cerrada que termina en el lunes más reciente.
 *
 * El corte es la medianoche local del lunes, no el momento en que corre el
 * cron. Así los bloques encajan sin huecos ni superposiciones: lo que se venda
 * el lunes a la mañana, antes de que salga el reporte, entra en el de la
 * semana siguiente y no se cuenta dos veces.
 *
 * El desfase se aplica antes de mirar el día de la semana. Sin eso, un domingo
 * a las 22:00 locales —que en UTC ya es lunes— saltaría una semana entera. */
export function rangoSemana(ahora: Date): { desde: Date; hasta: Date } {
  const local = new Date(ahora.getTime() + OFFSET_HORAS * UNA_HORA);

  // getUTCDay sobre la fecha ya corrida: 0 es domingo, 1 es lunes.
  const diasDesdeLunes = (local.getUTCDay() + 6) % 7;

  const medianocheLunesLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - diasDesdeLunes,
  );

  const hasta = new Date(medianocheLunesLocal - OFFSET_HORAS * UNA_HORA);
  const desde = new Date(hasta.getTime() - 7 * UN_DIA);
  return { desde, hasta };
}

/* El día local en `YYYY-MM-DD`, que es como Asaas filtra el extracto.
   Asaas razona en días calendario de la cuenta, no en instantes, así que el
   rango se le pide en días y no en marcas de tiempo. */
export function fechaLocalISO(fecha: Date): string {
  const local = new Date(fecha.getTime() + OFFSET_HORAS * UNA_HORA);
  return local.toISOString().slice(0, 10);
}

/* Los días que hay que pedirle al extracto para cubrir la semana.
   `hasta` es la medianoche del lunes y es exclusivo, así que el último día
   incluido es el domingo anterior: pedir hasta el lunes sumaría movimientos
   que pertenecen a la semana siguiente. */
export function diasParaExtracto(desde: Date, hasta: Date): { desde: string; hasta: string } {
  return {
    desde: fechaLocalISO(desde),
    hasta: fechaLocalISO(new Date(hasta.getTime() - UN_DIA)),
  };
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/* Día y mes en hora local, sin depender de la zona del servidor. */
function diaLocal(fecha: Date): { dia: number; mes: number } {
  const local = new Date(fecha.getTime() + OFFSET_HORAS * UNA_HORA);
  return { dia: local.getUTCDate(), mes: local.getUTCMonth() };
}

/* El rótulo del período, con el último día incluido.
   `hasta` es exclusivo —es la medianoche del lunes—, así que el día que se
   muestra es el anterior: decir "del 10 al 17" sugeriría que el 17 está
   adentro, y no lo está. */
function rotuloPeriodo(desde: Date, hasta: Date): string {
  const a = diaLocal(desde);
  const b = diaLocal(new Date(hasta.getTime() - UN_DIA));

  return a.mes === b.mes
    ? `${a.dia} al ${b.dia} de ${MESES[b.mes]}`
    : `${a.dia} de ${MESES[a.mes]} al ${b.dia} de ${MESES[b.mes]}`;
}

export function formatoDinero(cents: number): string {
  const reales = (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${reales}`;
}

/* Telegram interpreta HTML: el nombre del evento lo escribe una persona en el
   panel y podría traer un `<` o un `&` que rompa el mensaje entero. */
function escapar(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bloque(t: Totales): string[] {
  return [
    `🎟️ <b>Entradas vendidas:</b> ${t.entradas}`,
    `💰 <b>Total pagado:</b> ${formatoDinero(t.pagadoCents)}`,
    `🏦 <b>Total recibido:</b> ${
      t.recibidoCents === null ? "no disponible (Asaas no respondió)" : formatoDinero(t.recibidoCents)
    }`,
    `🎁 <b>Cortesías emitidas:</b> ${t.cortesias}`,
  ];
}

export function armarMensajeReporte(d: DatosReporte): string {
  return [
    "📊 <b>REPORTE SEMANAL · PRO KART</b>",
    `<i>${escapar(d.eventoNombre)}</i>`,
    `<i>Semana del ${rotuloPeriodo(d.desde, d.hasta)}</i>`,
    "",
    ...bloque(d.semana),
    "",
    "━━━━━ <b>Acumulado del evento</b> ━━━━━",
    "",
    ...bloque(d.acumulado),
    "",
    /* El pagado es lo que facturaste; el recibido es lo que Asaas realmente
       acreditó, ya sin comisiones. La diferencia entre los dos es la tarifa, y
       conviene que se lea como tal y no como un descuadre. */
    "<i>«Recibido» sale del extracto de Asaas: es lo que quedó después de las comisiones.</i>",
  ].join("\n");
}
