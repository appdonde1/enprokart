-- Reserva de sillas y expiración de holds.
-- Todas son SECURITY DEFINER y se ejecutan solo desde Edge Functions (service_role):
-- el rol anon no puede invocarlas, así nadie reserva sin pasar por el cobro.

-- Reserva la silla que el comprador eligió en el mapa (ORO / ÚNICA).
-- El UPDATE con `status = 'available'` en el WHERE es atómico: ante dos compradores
-- simultáneos sobre la misma silla, el segundo recibe 0 filas.
create or replace function public.hold_seat_manual(
  p_seat_id uuid,
  p_order_id uuid,
  p_ttl_minutes integer default 15
)
returns public.seats
language sql
security definer
set search_path = public
as $$
  update public.seats
  set status = 'held',
      held_by = p_order_id,
      held_until = now() + make_interval(mins => p_ttl_minutes)
  where id = p_seat_id
    and status = 'available'
  returning *;
$$;

-- Asigna automáticamente la próxima silla libre de la sección, por orden de llegada
-- (VIP PLATA). SKIP LOCKED evita que dos compradores concurrentes esperen el mismo
-- registro: cada uno toma la siguiente silla realmente disponible.
create or replace function public.hold_seat_auto_fcfs(
  p_section_id uuid,
  p_order_id uuid,
  p_ttl_minutes integer default 15
)
returns public.seats
language sql
security definer
set search_path = public
as $$
  update public.seats s
  set status = 'held',
      held_by = p_order_id,
      held_until = now() + make_interval(mins => p_ttl_minutes)
  where s.id = (
    select libre.id
    from public.seats libre
    join public.tables t on t.id = libre.table_id
    where t.section_id = p_section_id
      and libre.status = 'available'
    order by t.number, libre.number
    limit 1
    for update of libre skip locked
  )
  returning s.*;
$$;

-- Libera holds vencidos y marca sus órdenes como expiradas.
create or replace function public.expire_pending_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  liberadas integer;
begin
  update public.orders
  set status = 'expired'
  where status = 'pending'
    and pix_expires_at is not null
    and pix_expires_at < now();

  with released as (
    update public.seats
    set status = 'available',
        held_by = null,
        held_until = null
    where status = 'held'
      and held_until is not null
      and held_until < now()
    returning 1
  )
  select count(*) into liberadas from released;

  return liberadas;
end;
$$;

revoke all on function public.hold_seat_manual(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.hold_seat_auto_fcfs(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.expire_pending_holds() from public, anon, authenticated;
grant execute on function public.hold_seat_manual(uuid, uuid, integer) to service_role;
grant execute on function public.hold_seat_auto_fcfs(uuid, uuid, integer) to service_role;
grant execute on function public.expire_pending_holds() to service_role;
