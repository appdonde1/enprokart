const API_BASE = "https://api.pagar.me/core/v5";

function authHeader(): string {
  const key = Deno.env.get("PAGARME_SECRET_KEY");
  if (!key) throw new Error("Falta PAGARME_SECRET_KEY");
  return `Basic ${btoa(`${key}:`)}`;
}

// Pagar.me espera el teléfono partido en país / DDD / número.
function parsePhone(raw: string): { country_code: string; area_code: string; number: string } | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  if (digits.length < 10) return null;
  return {
    country_code: "55",
    area_code: digits.slice(0, 2),
    number: digits.slice(2),
  };
}

export type PixOrderInput = {
  amountCents: number;
  description: string;
  ticketCodeRef: string;
  expiresInSeconds: number;
  buyer: {
    name: string;
    lastname: string;
    document: string;
    whatsapp: string;
  };
};

export type PixOrderResult = {
  pagarmeOrderId: string;
  pagarmeChargeId: string | null;
  qrCode: string;
  qrCodeUrl: string | null;
  expiresAt: string | null;
};

export async function createPixOrder(input: PixOrderInput): Promise<PixOrderResult> {
  const document = input.buyer.document.replace(/\D/g, "");
  const phone = parsePhone(input.buyer.whatsapp);

  const body = {
    // `code` (máx. 52) y `metadata` viajan de ida y vuelta: así el webhook
    // sabe a qué orden nuestra corresponde el pago.
    code: input.ticketCodeRef,
    metadata: { order_id: input.ticketCodeRef },
    items: [{
      amount: input.amountCents,
      description: input.description,
      quantity: 1,
    }],
    customer: {
      name: `${input.buyer.name} ${input.buyer.lastname}`.trim(),
      // El formulario no pide email; Pagar.me exige uno con formato válido.
      email: `${document || "comprador"}@entradas.prokart.local`,
      type: "individual",
      document,
      document_type: document.length > 11 ? "CNPJ" : "CPF",
      ...(phone ? { phones: { mobile_phone: phone } } : {}),
    },
    payments: [{
      payment_method: "pix",
      pix: { expires_in: input.expiresInSeconds },
    }],
  };

  const response = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: { "Authorization": authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.message ?? `HTTP ${response.status}`;
    throw new Error(`Pagar.me rechazó la orden: ${detail}`);
  }

  const charge = payload?.charges?.[0];
  const transaction = charge?.last_transaction;
  const qrCode = transaction?.qr_code;
  if (!qrCode) throw new Error("Pagar.me no devolvió el código PIX");

  return {
    pagarmeOrderId: payload.id,
    pagarmeChargeId: charge?.id ?? null,
    qrCode,
    qrCodeUrl: transaction?.qr_code_url ?? null,
    expiresAt: transaction?.expires_at ?? null,
  };
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Pagar.me protege los webhooks con Basic Auth (usuario y contraseña que se
// configuran en el panel). Cuentas migradas desde la API antigua firman el cuerpo
// con HMAC en X-Hub-Signature. Se aceptan ambos y se rechaza si ninguno valida:
// sin autenticación cualquiera podría marcar entradas como pagadas.
export async function authenticateWebhook(req: Request, rawBody: string): Promise<boolean> {
  return (await checkBasicAuth(req)) || (await checkHmacSignature(req, rawBody));
}

async function checkBasicAuth(req: Request): Promise<boolean> {
  const user = Deno.env.get("PAGARME_WEBHOOK_USER");
  const password = Deno.env.get("PAGARME_WEBHOOK_PASSWORD");
  if (!user || !password) return false;

  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Basic ")) return false;

  return constantTimeEquals(header.slice(6).trim(), btoa(`${user}:${password}`));
}

async function checkHmacSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get("PAGARME_WEBHOOK_SECRET");
  const header = req.headers.get("X-Hub-Signature") ?? req.headers.get("x-hub-signature-256");
  if (!secret || !header) return false;

  const [algoRaw, received] = header.includes("=") ? header.split("=", 2) : ["sha1", header];
  const algo = algoRaw.toLowerCase().includes("256") ? "SHA-256" : "SHA-1";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return constantTimeEquals(hex(signature), received.trim().toLowerCase());
}
