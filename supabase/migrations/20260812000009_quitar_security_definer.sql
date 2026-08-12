-- Elimina la vista `tickets_staff`, que Supabase marca por ser SECURITY DEFINER.
--
-- La vista existía para que los meseros vieran entradas sin datos personales,
-- corriendo con permisos del dueño y usando `is_staff()` como única barrera.
-- Es frágil: si alguien edita la vista y olvida ese filtro, se abre la tabla
-- entera sin que ninguna política lo impida.
--
-- Ahora la barrera son los permisos por columna, que Postgres aplica siempre:
-- el panel lee `tickets` directamente pero solo alcanza las columnas que
-- necesita. El documento y el WhatsApp del comprador dejan de ser legibles
-- desde el navegador para cualquier rol, incluido el admin; las Edge Functions
-- los siguen usando porque service_role no pasa por estos permisos.

drop view if exists public.tickets_staff;

-- Cualquiera del personal puede consultar entradas; qué campos ve lo decide
-- el GRANT de abajo, no esta política.
drop policy if exists "admin ve tickets" on public.tickets;
create policy "el personal ve entradas"
  on public.tickets for select to authenticated
  using (public.is_staff());

revoke select on public.tickets from anon, authenticated;

grant select (
  id, event_id, section_id, code,
  section_code, section_label,
  table_number, seat_number, table_code, guest_index,
  buyer_name, buyer_lastname,
  status, used_at, is_courtesy, created_at
) on public.tickets to authenticated;

-- El resumen del panel necesita montos y estado de las órdenes, no los datos
-- de contacto del comprador.
revoke select on public.orders from anon, authenticated;

grant select (
  id, event_id, section_id, amount_cents, status,
  people, tables_count, is_courtesy, created_at
) on public.orders to authenticated;
