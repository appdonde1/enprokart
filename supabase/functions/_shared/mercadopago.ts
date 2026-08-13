/* Mercado Pago: cobro PIX generado por la API de Pagos.

   Se usa /v1/payments en vez de Checkout Pro porque el comprador no debe salir
   del sitio: Mercado Pago devuelve el QR y el código "copia e cola", y la propia
   página los muestra. */

const API = "https://api.mercadopago.com";

function accessToken(): string {
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) throw new Error("Falta MP_ACCESS_TOKEN");
  return token;
}

export type PixPaymentInput = {
  orderId: string;
  amountCents: number;
  description: string;
  expiresAt: string;
  notificationUrl: string;
  buyer: {
    name: string;
    lastname: string;
    document: string;
    whatsapp: string;
    email?: string;
  };
};

export type PixPaymentResult = {
  paymentId: string;
  qrCode: string;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
};

// Mercado Pago espera la fecha con desplazamiento horario explícito.
function toOffsetIso(iso: string): string {
  return new Date(iso).toISOString().replace("Z", "-00:00");
}

/* Reintenta ante fallos pasajeros de Mercado Pago.

   Su API devuelve 500 con "communication_error" cuando algo se cae de su lado,
   y eso pasa: durante las pruebas estuvo así un buen rato, con todos los
   métodos de cobro caídos. Sin reintentos, cada visitante que caiga en ese
   momento pierde la compra y su mesa. Se reintenta solo ante 5xx y 429, nunca
   ante un 400: si el pedido está mal formado, insistir no lo arregla.

   La clave de idempotencia se mantiene entre intentos para que un cobro que
   sí entró y falló al responder no se duplique. */
async function fetchConReintentos(
  url: string,
  opciones: RequestInit,
  intentos = 3,
): Promise<Response> {
  let ultima: Response | null = null;

  for (let i = 0; i < intentos; i++) {
    if (i > 0) {
      // 400ms, 1200ms: suficiente para un hipo, corto para no dejar esperando.
      await new Promise((r) => setTimeout(r, 400 * Math.pow(3, i - 1)));
    }

    let res: Response;
    try {
      res = await fetch(url, opciones);
    } catch (error) {
      // Falló la conexión: se reintenta salvo que fuera el último intento.
      if (i === intentos - 1) throw error;
      continue;
    }

    if (res.status < 500 && res.status !== 429) return res;

    ultima = res;
    console.warn(`mercadopago: intento ${i + 1} devolvió ${res.status}`);
  }

  return ultima!;
}

export async function createPixPayment(input: PixPaymentInput): Promise<PixPaymentResult> {
  const document = input.buyer.document.replace(/\D/g, "");

  // Mercado Pago exige un email con formato válido y rechaza dominios como
  // `.local`. Si el comprador no dejó el suyo se arma uno con su documento:
  // se pierde el comprobante que manda Mercado Pago, no la entrada, que la
  // emite este sistema.
  const email = input.buyer.email?.trim() || `${document || "comprador"}@prokart.com.br`;

  /* Mercado Pago solo entiende documentos brasileños: CPF de 11 dígitos y CNPJ
     de 14. Cualquier otra cosa la rechaza, y rechaza el cobro entero con ella.

     El sitio pide "cédula de identidad / CPF" y el salón está en Santa Elena,
     así que lo habitual es que llegue una cédula, que no es ninguna de las dos.
     Mandarla igual rotulada como CPF era lo que tiraba abajo la compra: seis
     intentos seguidos de la misma persona, todos con la mesa reservada y el
     cobro sin generar.

     La identificación es opcional para PIX. Si el documento no tiene forma de
     CPF ni de CNPJ no se manda, y el cobro sale igual. El documento no se
     pierde: sigue guardado en la orden y en la entrada, que es donde hace falta
     para identificar a la persona en la puerta. */
  const esCPF = document.length === 11;
  const esCNPJ = document.length === 14;

  const body = {
    transaction_amount: Number((input.amountCents / 100).toFixed(2)),
    description: input.description,
    payment_method_id: "pix",
    external_reference: input.orderId,
    notification_url: input.notificationUrl,
    date_of_expiration: toOffsetIso(input.expiresAt),
    payer: {
      email,
      first_name: input.buyer.name,
      last_name: input.buyer.lastname,
      ...(esCPF || esCNPJ
        ? {
          identification: {
            type: esCNPJ ? "CNPJ" : "CPF",
            number: document,
          },
        }
        : {}),
    },
  };

  const response = await fetchConReintentos(`${API}/v1/payments`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      // Si el request se reintenta, Mercado Pago no cobra dos veces.
      "X-Idempotency-Key": input.orderId,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detalle = payload?.message ?? payload?.error ?? `HTTP ${response.status}`;
    throw new Error(`Mercado Pago rechazó el cobro: ${detalle}`);
  }

  const datos = payload?.point_of_interaction?.transaction_data;
  if (!datos?.qr_code) throw new Error("Mercado Pago no devolvió el código PIX");

  return {
    paymentId: String(payload.id),
    qrCode: datos.qr_code,
    qrCodeBase64: datos.qr_code_base64 ?? null,
    ticketUrl: datos.ticket_url ?? null,
  };
}

export type PaymentInfo = {
  id: string;
  status: string;
  externalReference: string | null;
};

export async function getPayment(paymentId: string): Promise<PaymentInfo | null> {
  const response = await fetchConReintentos(`${API}/v1/payments/${paymentId}`, {
    headers: { "Authorization": `Bearer ${accessToken()}` },
  });
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  if (!payload) return null;

  return {
    id: String(payload.id),
    status: payload.status,
    externalReference: payload.external_reference ?? null,
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Valida la firma del webhook.

   Mercado Pago manda `x-signature: ts=...,v1=...` y arma el HMAC-SHA256 sobre
   la plantilla `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, donde data.id
   viene de la query string (en minúsculas si trae mayúsculas) y las partes
   ausentes se omiten. Sin secreto configurado se rechaza todo: es preferible a
   dar por pagada una entrada que nadie pagó. */
export async function verifyWebhookSignature(req: Request, dataId: string | null): Promise<boolean> {
  const secret = Deno.env.get("MP_WEBHOOK_SECRET");
  const signature = req.headers.get("x-signature");
  if (!secret || !signature) return false;

  let ts = "";
  let v1 = "";
  for (const parte of signature.split(",")) {
    const [clave, valor] = parte.split("=", 2).map((s) => s?.trim());
    if (clave === "ts") ts = valor ?? "";
    if (clave === "v1") v1 = valor ?? "";
  }
  if (!ts || !v1) return false;

  const requestId = req.headers.get("x-request-id");

  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return constantTimeEquals(hex, v1.toLowerCase());
}
