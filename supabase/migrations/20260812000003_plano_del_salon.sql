-- Reestructura el salón según el plano real y pasa la venta a "por mesa".
--
-- Antes: un área ORO de 8 mesas y el comprador elegía una silla suelta.
-- Ahora: secciones A, B y C con 9 mesas cada una alrededor de la pasarela, la
-- mesa se vende completa, y el precio de la sección es el precio de una mesa.

-- ---------------------------------------------------------------- mesas

-- Código visible de la mesa ("A1", "C5"): es como la nombra el comprador y como
-- se identifica su silla ("A1-1").
alter table public.tables add column if not exists code text;

comment on column public.tables.code is
  'Identificador de la mesa en el plano: A1..A9, B1..B9, C1..C9.';

-- ---------------------------------------------------------------- secciones

-- `manual` pasa a significar "elige mesa" (antes era "elige silla").
comment on column public.sections.assignment_mode is
  'manual = el comprador elige mesas en el plano; auto_fcfs = el backend asigna;
   none = sin lugar asignado (se paga y se entra).';

-- Precio de una mesa completa, no de una silla.
comment on column public.sections.price_cents is
  'Para secciones con mesas es el precio de UNA mesa completa. Para las demás,
   el precio por persona.';

alter table public.events
  add column if not exists tagline text,
  add column if not exists cover_image text;

comment on column public.events.tagline is 'Bajada del evento, ej. "Noche de folklor venezolano".';
comment on column public.events.cover_image is 'Archivo de portada servido junto al sitio.';

-- ---------------------------------------------------------------- entradas

-- Un grupo compra varias mesas y recibe una entrada por persona.
alter table public.orders
  add column if not exists people integer not null default 1,
  add column if not exists tables_count integer not null default 1;

alter table public.tickets
  add column if not exists table_code text,
  add column if not exists guest_index integer;

comment on column public.tickets.table_code is 'Mesa asignada, ej. "A1" o "C5".';
comment on column public.tickets.guest_index is 'Número de invitado dentro de la compra (1..N).';

-- Una compra deja de tener una sola silla: las mesas van en su propia tabla.
create table if not exists public.order_tables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  table_id uuid not null references public.tables (id) on delete restrict,
  table_code text not null,
  unique (order_id, table_id)
);

alter table public.order_tables enable row level security;

create policy "admin ve mesas de la orden"
  on public.order_tables for select to authenticated
  using (public.is_admin());

grant select on public.order_tables to authenticated;

-- ---------------------------------------------------------------- reservar mesa entera

-- Toma la mesa completa en un solo UPDATE: o quedan todas sus sillas reservadas,
-- o no queda ninguna. Si otra compra se adelantó, no devuelve filas.
create or replace function public.hold_table(
  p_table_id uuid,
  p_order_id uuid,
  p_ttl_minutes integer default 15
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tomadas integer;
  reservadas integer;
begin
  select count(*) into tomadas
  from public.seats
  where table_id = p_table_id and status <> 'available';

  if tomadas > 0 then
    return 0;
  end if;

  with tomadas_ahora as (
    update public.seats
    set status = 'held',
        held_by = p_order_id,
        held_until = now() + make_interval(mins => p_ttl_minutes)
    where table_id = p_table_id
      and status = 'available'
    returning 1
  )
  select count(*) into reservadas from tomadas_ahora;

  return reservadas;
end;
$$;

revoke all on function public.hold_table(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.hold_table(uuid, uuid, integer) to service_role;

-- Estado de cada mesa para el plano público: libre solo si ninguna silla está tomada.
create or replace view public.tables_public
with (security_invoker = true) as
  select
    t.id,
    t.section_id,
    t.number,
    t.code,
    t.label,
    t.seat_count,
    t.pos_x,
    t.pos_y,
    (count(s.id) filter (where s.status <> 'available') = 0) as available
  from public.tables t
  left join public.seats s on s.table_id = t.id
  group by t.id;

grant select on public.tables_public to anon, authenticated;

-- ---------------------------------------------------------------- nuevo salón

do $$
declare
  v_event uuid;
  v_section uuid;
  v_letra text;
  v_n integer;
  v_sillas integer;
  v_label text;
begin
  select id into v_event from public.events where slug = 'noche-vip-fest';
  if v_event is null then
    raise notice 'No existe el evento base; se omite la reconfiguración.';
    return;
  end if;

  update public.events
  set name = 'Jorge Guerrero en vivo',
      tagline = 'Noche de folklor venezolano',
      cover_image = 'evento.jpg'
  where id = v_event;

  -- Las secciones viejas se eliminan solo si nadie compró todavía.
  if exists (select 1 from public.tickets where event_id = v_event) then
    raise exception 'El evento ya tiene entradas emitidas: reconfigurar el salón borraría datos vendidos.';
  end if;

  delete from public.sections
  where event_id = v_event and code in ('ORO', 'UNICA', 'VIP_PLATA');

  -- Secciones A, B y C: 9 mesas cada una, en grilla de 3x3 (C va en una fila).
  foreach v_letra in array array['A', 'B', 'C'] loop
    insert into public.sections
      (event_id, code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color)
    values (
      v_event,
      v_letra,
      'Sección ' || v_letra,
      15000,
      true,
      'manual',
      54,
      case v_letra when 'A' then 1 when 'B' then 2 else 3 end,
      '#d4af37'
    )
    returning id into v_section;

    for v_n in 1..9 loop
      v_sillas := 6;
      v_label := null;

      -- La del centro de la Sección C es la mesa Única.
      if v_letra = 'C' and v_n = 5 then
        v_sillas := 8;
        v_label := 'Única';
      end if;

      insert into public.tables (section_id, number, code, seat_count, pos_x, pos_y, label)
      values (
        v_section,
        v_n,
        v_letra || v_n,
        v_sillas,
        case when v_letra = 'C' then v_n else ((v_n - 1) % 3) + 1 end,
        case when v_letra = 'C' then 1 else ((v_n - 1) / 3) + 1 end,
        v_label
      );
    end loop;
  end loop;

  -- Plata: se paga y se llega temprano. Sin mapa ni lugar asignado.
  insert into public.sections
    (event_id, code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color, notice)
  values (
    v_event, 'PLATA', 'Sección Plata', 10000, false, 'none', 480, 4, '#c0c0c8',
    'En Plata no se elige lugar: la mesa se asigna por orden de llegada el día del evento.'
  );

  update public.sections
  set sort_order = 5
  where event_id = v_event and code = 'GENERAL';
end;
$$;

-- La mesa Única tiene su propio precio, editable desde el panel igual que el resto.
-- Se modela como sección propia para poder ponerle precio sin tocar el código.
do $$
declare
  v_event uuid;
  v_seccion_c uuid;
  v_unica uuid;
  v_mesa uuid;
begin
  select id into v_event from public.events where slug = 'noche-vip-fest';
  if v_event is null then return; end if;

  select id into v_seccion_c from public.sections where event_id = v_event and code = 'C';
  if v_seccion_c is null then return; end if;

  insert into public.sections
    (event_id, code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color)
  values (v_event, 'UNICA', 'Mesa Única', 25000, true, 'manual', 8, 3, '#ffb703')
  on conflict (event_id, code) do nothing
  returning id into v_unica;

  if v_unica is null then
    select id into v_unica from public.sections where event_id = v_event and code = 'UNICA';
  end if;

  -- C5 pasa a pertenecer a la sección Única, pero conserva su lugar en el plano.
  select id into v_mesa from public.tables where section_id = v_seccion_c and number = 5;
  if v_mesa is not null then
    update public.tables set section_id = v_unica where id = v_mesa;
  end if;
end;
$$;
