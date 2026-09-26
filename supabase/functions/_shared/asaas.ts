/* Asaas: cobro PIX.
 *
 * Dos cosas de Asaas condicionan el diseño y no solo la forma de llamarlo:
 *
 * 1. Asaas exige un `customer` para cada cobranza, y para crear un customer
 *    exige `cpfCnpj`. No hay forma de omitirlo. Como el sitio dejó de pedir el
 *    documento —el salón está en Santa Elena y la gente tiene cédula, no CPF—,
 *    todas las cobranzas cuelgan de un único cliente: el local. Quién pagó se
 *    sabe por el PIX y por `externalReference`, que lleva el id de la orden.
 *
 * 2. El QR de Asaas NO vence en minutos. Vive hasta las 23:59 del día, o doce
 *    meses si hay clave PIX registrada. La reserva de la mesa dura cinco
 *    minutos. Sin hacer nada, a los cinco minutos la mesa se revende y el QR
 *    viejo sigue cobrando: dos grupos en la misma mesa.
 *
 *    Por eso `cancelarCobro` existe y `expire-holds` la llama al soltar la
 *    reserva. Y por si algo se escapa, el webhook devuelve la plata en vez de
 *    emitir una entrada que pisaría a otra.
 */

const BASE = Deno.env.get("ASAAS_ENV") === "produccion"
  ? "https://api.asaas.com/v3"
  : "https://api-sandbox.asaas.com/v3";

// El CPF del local. Todas las cobranzas cuelgan de este cliente.
const CPF_LOCAL = Deno.env.get("ASAAS_CPF_LOCAL") ?? "";
const NOMBRE_LOCAL = "Pro Kart";

function clave(): string {
  const k = Deno.env.get("ASAAS_API_KEY");
  if (!k) throw new Error("Falta ASAAS_API_KEY");
  return k;
}

/* Reintenta ante fallos pasajeros.

   Solo ante 5xx y 429: si el pedido está mal formado, insistir no lo arregla.
   Nunca se reintenta un POST de cobranza sin la misma referencia externa, que
   es lo que evita cobrar dos veces. */
async function pedir(
  ruta: string,
  opciones: RequestInit = {},
  intentos = 3,
): Promise<Response> {
  let ultima: Response | null = null;

  for (let i = 0; i < intentos; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400 * Math.pow(3, i - 1)));

    let res: Response;
    try {
      res = await fetch(`${BASE}${ruta}`, {
        ...opciones,
        headers: {
          "access_token": clave(),
          "Content-Type": "application/json",
          ...(opciones.headers ?? {}),
        },
      });
    } catch (error) {
      if (i === intentos - 1) throw error;
      continue;
    }

    if (res.status < 500 && res.status !== 429) return res;
    ultima = res;
    console.warn(`asaas: intento ${i + 1} devolvió ${res.status} en ${ruta}`);
  }
  return ultima!;
}

async function leer(res: Response): Promise<any> {
  const texto = await res.text();
  try { return texto ? JSON.parse(texto) : null; } catch { return null; }
}

function detalleDeError(cuerpo: any, res: Response): string {
  const e = cuerpo?.errors?.[0];
  return e?.description ?? e?.code ?? cuerpo?.message ?? `HTTP ${res.status}`;
}

/* ---------------------------------------------------------------- cliente */

// El id del cliente no cambia nunca; se resuelve una vez por instancia.
let clienteCache = "";

async function clienteDelLocal(): Promise<string> {
  if (clienteCache) return clienteCache;
  if (!CPF_LOCAL) throw new Error("Falta ASAAS_CPF_LOCAL");

  // Si ya existe, se reutiliza. Crear uno nuevo en cada arranque llenaría la
  // cuenta de clientes repetidos con el mismo CPF.
  const busca = await pedir(`/customers?cpfCnpj=${encodeURIComponent(CPF_LOCAL)}&limit=1`);
  const hallado = await leer(busca);
  if (busca.ok && hallado?.data?.length) {
    clienteCache = hallado.data[0].id;
    return clienteCache;
  }

  const alta = await pedir("/customers", {
    method: "POST",
    body: JSON.stringify({ name: NOMBRE_LOCAL, cpfCnpj: CPF_LOCAL }),
  });
  const nuevo = await leer(alta);
  if (!alta.ok || !nuevo?.id) {
    throw new Error(`Asaas no pudo crear el cliente: ${detalleDeError(nuevo, alta)}`);
  }
  clienteCache = nuevo.id;
  return clienteCache;
}

/* ---------------------------------------------------------------- cobro */

export type CobroPix = {
  paymentId: string;
  qrCode: string;
  qrCodeBase64: string | null;
};

export type DatosCobro = {
  orderId: string;
  amountCents: number;
  description: string;
  buyer: { nombre: string; apellido: string; whatsapp: string; email?: string };
};

export async function crearCobroPix(d: DatosCobro): Promise<CobroPix> {
  const customer = await clienteDelLocal();

  // dueDate es obligatorio y va en días, no en minutos. Se pone hoy: la
  // ventana real de pago la marca la reserva de la mesa, y cuando esa vence
  // `expire-holds` cancela esta cobranza.
  const hoy = new Date().toISOString().slice(0, 10);

  const alta = await pedir("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer,
      billingType: "PIX",
      value: Number((d.amountCents / 100).toFixed(2)),
      dueDate: hoy,
      description: d.description.slice(0, 500),
      // Con esto el webhook sabe a qué orden pertenece el pago.
      externalReference: d.orderId,
    }),
  });

  const cobro = await leer(alta);
  if (!alta.ok || !cobro?.id) {
    throw new Error(`Asaas rechazó el cobro: ${detalleDeError(cobro, alta)}`);
  }

  // El QR se pide aparte. Va sin cuerpo: con cuerpo, Asaas responde 403.
  const qr = await pedir(`/payments/${cobro.id}/pixQrCode`, { method: "GET" });
  const datos = await leer(qr);
  if (!qr.ok || !datos?.payload) {
    // La cobranza quedó creada pero sin QR: se cancela para no dejarla viva.
    await cancelarCobro(cobro.id).catch(() => {});
    throw new Error(`Asaas no devolvió el QR PIX: ${detalleDeError(datos, qr)}`);
  }

  return {
    paymentId: String(cobro.id),
    qrCode: datos.payload,
    qrCodeBase64: datos.encodedImage ?? null,
  };
}

export type EstadoCobro = {
  id: string;
  status: string;
  externalReference: string | null;
  valueCents: number;
  netValueCents: number;
};

export async function obtenerCobro(paymentId: string): Promise<EstadoCobro | null> {
  const res = await pedir(`/payments/${paymentId}`, { method: "GET" });
  if (!res.ok) return null;
  const p = await leer(res);
  if (!p?.id) return null;

  return {
    id: String(p.id),
    status: String(p.status ?? ""),
    externalReference: p.externalReference ?? null,
    valueCents: Math.round(Number(p.value ?? 0) * 100),
    /* Lo que queda después de la comisión, según Asaas.
       Ojo: `netValue` descuenta la tarifa del PIX pero no la de mensajería, que
       Asaas cobra aparte y en otro movimiento. Para un aviso de compra alcanza;
       cuando el número tiene que cuadrar con el banco —el reporte semanal— se
       usa `recibidoNetoCents`, que lee el extracto de verdad. */
    netValueCents: Math.round(Number(p.netValue ?? p.value ?? 0) * 100),
  };
}

/* Cancela una cobranza que todavía no se pagó.

   Es lo que impide que el QR de una reserva vencida siga cobrando después de
   que la mesa volvió a la venta. */
export async function cancelarCobro(paymentId: string): Promise<boolean> {
  const res = await pedir(`/payments/${paymentId}`, { method: "DELETE" });
  return res.ok;
}

/* Devuelve un pago que entró cuando ya no correspondía.

   Pasa si alguien paga un QR viejo justo entre que la reserva vence y la
   cancelación llega. Devolver la plata es peor negocio que emitir una entrada
   para una mesa que ya se vendió, pero es lo correcto: la otra opción es que
   dos grupos se presenten a la misma mesa. */
export async function reembolsar(paymentId: string, motivo: string): Promise<boolean> {
  const res = await pedir(`/payments/${paymentId}/refund`, {
    method: "POST",
    body: JSON.stringify({ description: motivo.slice(0, 255) }),
  });
  return res.ok;
}

/* ---------------------------------------------------------------- extracto */

/* Cuánto entró de verdad en la cuenta entre dos fechas, ya sin comisiones.
 *
 * No es `sum(amount_cents)` menos una tarifa que supongamos: es el extracto de
 * Asaas, el mismo que mira la administración. Por eso el número del reporte
 * cuadra con el banco aunque Asaas cambie sus tarifas o cobre una que no
 * conocíamos —como la de mensajería, que `netValue` no descuenta.
 *
 * Las transferencias al banco se excluyen: sacar la plata no es perderla, es
 * moverla. Lo que sí resta son las tarifas y los reembolsos, que son plata que
 * de verdad no quedó.
 *
 * Las fechas van en `YYYY-MM-DD` y son inclusivas de los dos lados. El huso lo
 * resuelve quien llama: acá solo se pasan los días ya calculados. */
export async function recibidoNetoCents(desde: string, hasta: string): Promise<number | null> {
  const POR_PAGINA = 100;
  let total = 0;
  let offset = 0;

  for (let pagina = 0; pagina < 50; pagina++) {
    const res = await pedir(
      `/financialTransactions?limit=${POR_PAGINA}&offset=${offset}` +
        `&startDate=${encodeURIComponent(desde)}&finishDate=${encodeURIComponent(hasta)}`,
      { method: "GET" },
    );
    if (!res.ok) return null;

    const cuerpo = await leer(res);
    const filas: any[] = cuerpo?.data ?? [];

    for (const t of filas) {
      // TRANSFER y sus reversos mueven plata entre cuentas propias: no son
      // ingreso ni pérdida, y sumarlos daría siempre cerca de cero.
      if (String(t.type ?? "").startsWith("TRANSFER")) continue;
      total += Math.round(Number(t.value ?? 0) * 100);
    }

    if (filas.length < POR_PAGINA) return total;
    offset += POR_PAGINA;
  }

  // Cincuenta páginas son 5.000 movimientos: si se llega acá, algo anda mal y
  // es preferible avisar que informar un total recortado.
  console.warn("asaas/recibidoNetoCents: demasiadas páginas, total incompleto");
  return null;
}

/* ---------------------------------------------------------------- webhook */

/* Asaas manda el token que uno configuró, tal cual, en `asaas-access-token`.
   No hay firma HMAC: la seguridad es que el token no se conozca. Sin secreto
   configurado se rechaza todo — es preferible a dar por pagada una entrada que
   nadie pagó. */
export function tokenValido(req: Request): boolean {
  const esperado = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  const recibido = req.headers.get("asaas-access-token");
  if (!esperado || !recibido) return false;
  if (esperado.length !== recibido.length) return false;

  let diff = 0;
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  }
  return diff === 0;
}

/* Los estados de Asaas, agrupados en lo único que le importa a este sistema.

   RECEIVED y CONFIRMED son ambos "pagado": CONFIRMED es que entró y RECEIVED
   que además está disponible. Para emitir la entrada alcanza con la primera. */
export const PAGADO = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
export const CAIDO = [
  "REFUNDED",
  "REFUND_REQUESTED",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
  "PAYMENT_DELETED",
  "OVERDUE",
];
