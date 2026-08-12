-- RLS: sin policy explícita, nada pasa. Las Edge Functions usan service_role y
-- no dependen de estas políticas.

alter table public.events enable row level security;
alter table public.sections enable row level security;
alter table public.tables enable row level security;
alter table public.seats enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.webhook_events enable row level security;
alter table public.staff_profiles enable row level security;

-- ---------------------------------------------------------------- roles de staff

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff_profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() = 'admin', false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() in ('admin', 'mesero'), false);
$$;

grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------- privilegios de tabla

-- Explícitos y no heredados: el comprador anónimo solo lee el catálogo del evento.
grant select on public.events to anon, authenticated;
grant select on public.sections to anon, authenticated;
grant select on public.tables to anon, authenticated;

-- `held_by` guarda el id de la orden que reservó la silla, y ese id es el token con
-- el que el comprador consulta su propio pago. Exponerlo permitiría leer órdenes
-- ajenas, así que el mapa público recibe solo estas cuatro columnas.
grant select (id, table_id, number, status) on public.seats to anon, authenticated;

grant select on public.orders to authenticated;
grant select on public.tickets to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.sections to authenticated;
grant select, insert, update, delete on public.tables to authenticated;
grant select on public.staff_profiles to authenticated;
grant insert, update, delete on public.staff_profiles to authenticated;

-- ---------------------------------------------------------------- catálogo público

create policy "eventos publicados visibles"
  on public.events for select to anon, authenticated
  using (status = 'published' or public.is_staff());

create policy "secciones de eventos publicados visibles"
  on public.sections for select to anon, authenticated
  using (
    public.is_staff()
    or exists (select 1 from public.events e where e.id = event_id and e.status = 'published')
  );

create policy "mesas de eventos publicados visibles"
  on public.tables for select to anon, authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.sections s
      join public.events e on e.id = s.event_id
      where s.id = section_id and e.status = 'published'
    )
  );

-- Filas visibles para todos; las columnas sensibles ya quedaron fuera del GRANT.
-- Realtime respeta ambos niveles, así que el mapa se actualiza en vivo sin filtrar datos.
create policy "estado de sillas visible"
  on public.seats for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------- administración

create policy "admin gestiona eventos"
  on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin gestiona secciones"
  on public.sections for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin gestiona mesas"
  on public.tables for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin ve ordenes"
  on public.orders for select to authenticated
  using (public.is_admin());

-- Solo admin lee la tabla completa (documento y whatsapp del comprador).
-- Los meseros usan la vista `tickets_staff`, que omite esos campos.
create policy "admin ve tickets"
  on public.tickets for select to authenticated
  using (public.is_admin());

create policy "staff ve su perfil"
  on public.staff_profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "admin gestiona staff"
  on public.staff_profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- `orders`, `tickets` y `webhook_events` no tienen policies de INSERT/UPDATE/DELETE
-- para ningún rol: cobrar, emitir y validar entradas ocurre solo en Edge Functions.

-- ---------------------------------------------------------------- vistas

-- Mapa de sillas para el frontend. Hereda la RLS de quien consulta.
create view public.seats_public
with (security_invoker = true) as
  select id, table_id, number, status
  from public.seats;

grant select on public.seats_public to anon, authenticated;

-- Los meseros necesitan ubicar invitados, no ver datos personales ni de pago.
-- Corre con permisos del dueño (bypassa RLS), por eso el filtro is_staff() es el gate.
create view public.tickets_staff
with (security_invoker = false) as
  select
    id, event_id, code, section_code, section_label,
    table_number, seat_number,
    buyer_name, buyer_lastname,
    status, used_at, created_at
  from public.tickets
  where public.is_staff();

grant select on public.tickets_staff to authenticated;
