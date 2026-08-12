import { serviceClient } from "../_shared/supabase.ts";
import { fail, json, preflight } from "../_shared/http.ts";

// El id de la orden es un UUID impredecible y funciona como token de acceso:
// solo quien acaba de comprar lo tiene.
Deno.serve(async (req) => {
  const cors = preflight(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail("Método no permitido", 405);

  let orderId: string | undefined;
  try {
    orderId = (await req.json())?.order_id;
  } catch {
    return fail("Cuerpo inválido");
  }
  if (!orderId) return fail("Falta order_id");

  const db = serviceClient();

  const { data: order } = await db
    .from("orders")
    .select("id, status, amount_cents, people, buyer_name, buyer_lastname, expires_at")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return fail("Orden no encontrada", 404);

  if (order.status !== "paid") {
    return json({ status: order.status, expires_at: order.expires_at });
  }

  // Una compra puede haber emitido varias entradas, una por invitado.
  const { data: tickets } = await db
    .from("tickets")
    .select("code, qr_signature, section_code, section_label, table_code, guest_index, buyer_name, buyer_lastname")
    .eq("order_id", order.id)
    .order("guest_index");

  return json({
    status: "paid",
    amount_cents: order.amount_cents,
    people: order.people,
    tickets: tickets ?? [],
    ticket: tickets?.[0] ?? null,
  });
});
