-- Cierra la lectura de columnas sensibles de `seats`.
--
-- La migración de RLS concedía las cuatro columnas públicas, pero Supabase ya
-- otorga por defecto la tabla entera a `anon` y `authenticated`, así que aquel
-- GRANT solo sumaba: `held_by` seguía siendo legible. Ese campo guarda el id de
-- la orden, que es el token con el que el comprador consulta su propio pago, de
-- modo que exponerlo permitiría leer órdenes ajenas y quedarse con códigos de
-- entrada. Hay que revocar primero y volver a conceder solo lo público.

revoke select on public.seats from anon, authenticated;

grant select (id, table_id, number, status) on public.seats to anon, authenticated;

-- Estas se leen solo desde Edge Functions con service_role, que ignora RLS.
revoke all on public.orders from anon, authenticated;
revoke all on public.tickets from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;

-- El admin necesita ver órdenes y tickets desde el panel; la RLS ya limita a
-- quien tenga rol admin, y los meseros pasan por la vista `tickets_staff`.
grant select on public.orders to authenticated;
grant select on public.tickets to authenticated;
