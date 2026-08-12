/* Identifica a un visitante sin guardar quién es.

   El problema: para contar visitas de verdad hay que distinguir a una persona
   que recarga diez veces de diez personas distintas. Y para limitar el abuso de
   un formulario hay que saber que "es el mismo de antes". Las dos cosas piden
   una identidad; ninguna pide saber la identidad.

   La solución es un hash de IP + navegador con una sal que cambia cada día. Sirve
   para reconocer al mismo visitante dentro del día, y deja de servir mañana: el
   hash no se puede revertir a una IP y la misma persona no es rastreable entre
   días. Es lo que hacen Plausible y Fathom, y evita almacenar datos personales. */

// Lista corta y deliberada: solo lo que se anuncia como robot. Nada de heurísticas
// sobre navegadores raros, que terminarían descartando personas reales.
const ROBOTS =
  /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discord|preview|headless|phantom|puppeteer|playwright|curl|wget|python-requests|node-fetch|axios|postman|lighthouse|pingdom|uptime|monitor|scrapy|semrush|ahrefs|mj12/i;

export function esRobot(userAgent: string): boolean {
  if (!userAgent.trim()) return true; // un navegador real siempre manda uno
  return ROBOTS.test(userAgent);
}

/* La IP que ve la Edge Function.

   Detrás de proxies, `x-forwarded-for` trae la cadena completa y el primero es
   el cliente original. Los demás son intermediarios y no sirven para distinguir
   visitantes. */
export function ipDelCliente(req: Request): string {
  const cadena = req.headers.get("x-forwarded-for");
  if (cadena) {
    const primera = cadena.split(",")[0]?.trim();
    if (primera) return primera;
  }
  return req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    "sin-ip";
}

// La fecha en UTC, igual que el `current_date` de Postgres, para que el hash y
// la fila del día hablen del mismo día.
export function diaUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function hashVisitante(req: Request): Promise<string> {
  // Si no hay sal propia se cae en la del ticket, que ya es un secreto del
  // servidor. Lo que no puede pasar es hashear sin sal: sin ella, cualquiera
  // que sepa una IP puede calcular el hash y comprobar si esa persona entró.
  const sal = Deno.env.get("VISITS_SALT") ?? Deno.env.get("TICKET_HMAC_SECRET") ?? "";
  const ua = req.headers.get("user-agent") ?? "";
  const material = `${sal}|${diaUtc()}|${ipDelCliente(req)}|${ua}`;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
