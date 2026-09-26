/* El token del bot y los chats viven en los secretos de Supabase
   (TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_IDS, separados por coma). Estaban escritos
   en este archivo, y con el token cualquiera puede escribir como el bot. */
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_IDS = (Deno.env.get("TELEGRAM_CHAT_IDS") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

export interface NotificacionCompra {
  orderNumber: number | string;
  buyerName: string;
  buyerDocument?: string | null;
  buyerWhatsapp?: string | null;
  buyerEmail?: string | null;
  sectionLabel: string;
  tables?: string | null;
  people: number;
  amountCents: number;
  /* Lo que queda después de la comisión de Asaas. Va aparte del monto porque
     son dos preguntas distintas: cuánto pagó el comprador y cuánto entra a la
     cuenta. Las cortesías no lo llevan —no hay cobro— y por eso es opcional. */
  netCents?: number | null;
  isCourtesy?: boolean;
  reason?: string | null;
  ticketsCount: number;
}

function formatoDinero(cents: number): string {
  if (cents === 0) return "R$ 0,00 (Cortesía)";
  const reales = (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${reales}`;
}

export async function notificarTelegram(compra: NotificacionCompra): Promise<void> {
  const tipo = compra.isCourtesy ? "🎁 <b>NUEVA CORTESÍA EMITIDA</b>" : "🎟️ <b>¡NUEVA COMPRA EN PRO KART!</b>";
  const lineas = [
    tipo,
    "",
    `📦 <b>Orden:</b> #${compra.orderNumber}`,
    `👤 <b>Comprador:</b> ${compra.buyerName}`,
  ];

  if (compra.buyerDocument) {
    lineas.push(`🪪 <b>Cédula / Documento:</b> ${compra.buyerDocument}`);
  }
  if (compra.buyerWhatsapp) {
    lineas.push(`📱 <b>WhatsApp:</b> ${compra.buyerWhatsapp}`);
  }
  if (compra.buyerEmail) {
    lineas.push(`✉️ <b>Correo:</b> ${compra.buyerEmail}`);
  }

  lineas.push(
    `📍 <b>Sección:</b> ${compra.sectionLabel}`,
    compra.tables ? `🪑 <b>Mesa(s):</b> ${compra.tables}` : `🪑 <b>Lugar:</b> Sin mesa numerada`,
    `👥 <b>Personas / Entradas:</b> ${compra.people} persona(s) (${compra.ticketsCount} entrada(s))`,
    `💰 <b>Monto:</b> ${formatoDinero(compra.amountCents)}`,
  );

  /* El neto solo se muestra cuando hubo cobro de verdad y Asaas nos dijo
     cuánto quedó. Si el aviso llegó sin el dato, es mejor no mostrar la línea
     que mostrar un número inventado. */
  if (!compra.isCourtesy && typeof compra.netCents === "number" && compra.netCents > 0) {
    const comision = compra.amountCents - compra.netCents;
    lineas.push(
      `🏦 <b>Neto a la cuenta:</b> ${formatoDinero(compra.netCents)}`,
      `➖ <b>Comisión Asaas:</b> ${formatoDinero(comision)}`,
    );
  }

  if (compra.isCourtesy && compra.reason) {
    lineas.push(`📝 <b>Motivo cortesía:</b> ${compra.reason}`);
  }

  await enviarATodos(lineas.join("\n"));
}

/* Manda un mensaje ya armado a los tres chats.
 *
 * `allSettled` y no `all`: que un chat falle —alguien bloqueó el bot, se cayó
 * Telegram— no puede impedir que los otros dos se enteren. Y ningún error sube:
 * quien llama está emitiendo una entrada o cerrando una compra, y eso no se
 * arruina porque no salga un aviso. */
async function enviarATodos(texto: string): Promise<void> {
  // Sin secretos cargados no hay a quién avisar: se deja constancia y se sigue.
  if (!BOT_TOKEN || !CHAT_IDS.length) {
    console.warn("telegram/sin configurar: faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_IDS");
    return;
  }
  await Promise.allSettled(
    CHAT_IDS.map(async (chatId) => {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: texto,
            parse_mode: "HTML",
          }),
        });
        if (!resp.ok) {
          const err = await resp.text();
          console.warn(`telegram/fallo chat ${chatId}:`, err);
        }
      } catch (err) {
        console.error(`telegram/error chat ${chatId}:`, err);
      }
    }),
  );
}

/* El reporte semanal. El texto lo arma `_shared/reporte.ts`, que se prueba sin
   red; acá solo se entrega. */
export async function enviarReporte(texto: string): Promise<void> {
  await enviarATodos(texto);
}
