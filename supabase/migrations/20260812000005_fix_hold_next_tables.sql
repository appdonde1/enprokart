-- Corrige `hold_next_tables`: las columnas de salida se llamaban `table_id` y
-- `table_code`, iguales a columnas reales de `seats` y `tables`, así que dentro
-- de la función Postgres no sabía a cuál se refería el WHERE y fallaba con
-- "column reference table_id is ambiguous". Se renombran las salidas.

drop function if exists public.hold_next_tables(uuid, uuid, integer, integer);

create or replace function public.hold_next_tables(
  p_section_id uuid,
  p_order_id uuid,
  p_cantidad integer,
  p_ttl_minutes integer default 15
)
returns table (mesa_id uuid, mesa_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elegidas uuid[];
begin
  select array_agg(libres.id) into v_elegidas
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

  -- O alcanzan todas las mesas pedidas, o no se reserva ninguna.
  if v_elegidas is null or array_length(v_elegidas, 1) < p_cantidad then
    return;
  end if;

  update public.seats s
  set status = 'held',
      held_by = p_order_id,
      held_until = now() + make_interval(mins => p_ttl_minutes)
  where s.table_id = any(v_elegidas);

  return query
    select t.id, t.code from public.tables t
    where t.id = any(v_elegidas)
    order by t.number;
end;
$$;

revoke all on function public.hold_next_tables(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.hold_next_tables(uuid, uuid, integer, integer) to service_role;
