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
  buyer: { name: string; lastname: string; document: string; whatsapp: string };
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

export async function createPixPayment(input: PixPaymentInput): Promise<PixPaymentResult> {
  const document = input.buyer.document.replace(/\D/g, "");

  const body = {
    transaction_amount: Number((input.amountCents / 100).toFixed(2)),
    description: input.description,
    payment_method_id: "pix",
    external_reference: input.orderId,
    notification_url: input.notificationUrl,
    date_of_expiration: toOffsetIso(input.expiresAt),
    payer: {
      email: `${document || "comprador"}@entradas.prokart.local`,
      first_name: input.buyer.name,
      last_name: input.buyer.lastname,
      ...(document
        ? {
          identification: {
            type: document.length > 11 ? "CNPJ" : "CPF",
            number: document,
          },
        }
        : {}),
    },
  };

  const response = await fetch(`${API}/v1/payments`, {
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
  const response = await fetch(`${API}/v1/payments/${paymentId}`, {
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
