-- La reserva dura lo mismo que el QR: si el PIX vence, la mesa vuelve a la venta.
--
-- Además corrige una referencia rota. `expire_pending_holds()` se escribió
-- cuando la columna se llamaba `orders.pix_expires_at`; la migración
-- 20260812000001 la renombró a `expires_at`, pero el cuerpo de una función
-- plpgsql se guarda como texto y un `rename column` no lo reescribe. Desde
-- entonces esta función quedó apuntando a una columna que ya no existe, y es la
-- que el cron corre cada minuto para soltar las mesas vencidas.

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
    and expires_at is not null
    and expires_at < now();

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

revoke all on function public.expire_pending_holds() from public, anon, authenticated;
grant execute on function public.expire_pending_holds() to service_role;

-- Nota sobre el plazo del hold: quien manda es `create-order`, que pasa
-- `p_ttl_minutes` explícito en cada llamada (hoy 5 minutos). Los `default 15`
-- que quedaron en la firma de hold_table/hold_next_tables no se usan nunca;
-- cambiarlos exigiría reescribir el cuerpo completo de cada función, con el
-- riesgo de que se desincronice de la versión vigente. Si algún día se llama a
-- esas funciones sin plazo, hay que pasarlo explícito igual que hace la Edge
-- Function, no confiar en el default.
