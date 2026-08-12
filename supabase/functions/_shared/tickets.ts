const encoder = new TextEncoder();

function secret(): string {
  const value = Deno.env.get("TICKET_HMAC_SECRET");
  if (!value) throw new Error("Falta TICKET_HMAC_SECRET");
  return value;
}

export async function signTicket(code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(code));
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparación en tiempo constante: evita filtrar la firma correcta byte a byte.
export async function verifySignature(code: string, candidate: string): Promise<boolean> {
  const expected = await signTicket(code);
  if (expected.length !== candidate.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}

export function generateTicketCode(sectionCode: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `EVT-${sectionCode}-${stamp}-${random}`;
}
