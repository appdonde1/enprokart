-- Plata vuelve a tener mesas: 480 lugares en 120 mesas de 4.
--
-- El comprador no elige cuál le toca (eso se resuelve por orden de llegada el
-- día del evento), pero sí cuántas necesita, y esa cantidad es la que limita el
-- aforo. Por eso las mesas existen en la base aunque no se dibujen en el plano.

do $$
declare
  v_event uuid;
  v_plata uuid;
  v_n integer;
begin
  select id into v_event from public.events where slug = 'noche-vip-fest';
  if v_event is null then return; end if;

  if exists (select 1 from public.tickets where event_id = v_event) then
    raise exception 'El evento ya tiene entradas emitidas: no se reconfigura Plata.';
  end if;

  select id into v_plata from public.sections where event_id = v_event and code = 'PLATA';

  if v_plata is null then
    insert into public.sections
      (event_id, code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color, notice)
    values (v_event, 'PLATA', 'VIP Plata', 10000, true, 'auto_fcfs', 480, 4, '#c0c0c8', null)
    returning id into v_plata;
  else
    update public.sections
    set label = 'VIP Plata',
        has_seating = true,
        assignment_mode = 'auto_fcfs',
        capacity = 480,
        notice = 'En Plata no se elige la mesa: se asigna por orden de llegada el día del evento.'
    where id = v_plata;
  end if;

  -- 120 mesas de 4 sillas. El trigger de `tables` crea las sillas.
  if not exists (select 1 from public.tables where section_id = v_plata) then
    for v_n in 1..120 loop
      insert into public.tables (section_id, number, code, seat_count, pos_x, pos_y)
      values (v_plata, v_n, 'P' || v_n, 4, ((v_n - 1) % 12) + 1, ((v_n - 1) / 12) + 1);
    end loop;
  end if;
end;
$$;

-- Toma las primeras N mesas libres de una sección, todas o ninguna.
-- SKIP LOCKED evita que dos compras simultáneas se peleen por la misma mesa.
create or replace function public.hold_next_tables(
  p_section_id uuid,
  p_order_id uuid,
  p_cantidad integer,
  p_ttl_minutes integer default 15
)
returns table (table_id uuid, table_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elegidas uuid[];
begin
  select array_agg(id) into v_elegidas
  from (
    select t.id
    from public.tables t
    where t.section_id = p_section_id
      and not exists (
        select 1 from public.seats s
        where s.table_id = t.id and s.status <> 'available'
      )
    order by t.number
    limit p_cantidad
    for update of t skip locked
  ) libres;

  if v_elegidas is null or array_length(v_elegidas, 1) < p_cantidad then
    return;
  end if;

  update public.seats
  set status = 'held',
      held_by = p_order_id,
      held_until = now() + make_interval(mins => p_ttl_minutes)
  where table_id = any(v_elegidas);

  return query
    select t.id, t.code from public.tables t where t.id = any(v_elegidas) order by t.number;
end;
$$;

revoke all on function public.hold_next_tables(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.hold_next_tables(uuid, uuid, integer, integer) to service_role;

-- Cuántas mesas quedan libres por sección: lo que el sitio muestra como aforo.
create or replace view public.section_availability
with (security_invoker = true) as
  select
    s.id as section_id,
    s.code,
    count(t.id) as total_tables,
    count(t.id) filter (
      where not exists (
        select 1 from public.seats se
        where se.table_id = t.id and se.status <> 'available'
      )
    ) as free_tables
  from public.sections s
  left join public.tables t on t.section_id = s.id
  group by s.id;

grant select on public.section_availability to anon, authenticated;
