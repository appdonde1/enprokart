-- Retención de datos de 90 días y limpieza automática.
--
-- Los eventos pasados, compras viejas, tickets usados y webhooks acumulados
-- se depuran automáticamente a los 90 días para evitar que la base de datos
-- se llene o ralentice con el paso del tiempo.

create or replace function public.cleanup_old_records_90_days()
returns table (
  webhooks_eliminados integer,
  tickets_eliminados integer,
  ordenes_eliminadas integer,
  cortesias_eliminadas integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_webhooks integer := 0;
  v_tickets integer := 0;
  v_ordenes integer := 0;
  v_cortesias integer := 0;
  v_limite timestamptz := now() - interval '90 days';
begin
  -- 1. Webhooks antiguos
  with borrados as (
    delete from public.webhook_events
    where received_at < v_limite
    returning 1
  )
  select count(*) into v_webhooks from borrados;

  -- 2. Cortesías antiguas
  if exists (select 1 from information_schema.tables where table_name = 'courtesy_log') then
    with borrados as (
      delete from public.courtesy_log
      where created_at < v_limite
      returning 1
    )
    select count(*) into v_cortesias from borrados;
  end if;

  -- 3. Tickets antiguos (usados o cancelados)
  with borrados as (
    delete from public.tickets
    where created_at < v_limite
      and status in ('used', 'canceled')
    returning 1
  )
  select count(*) into v_tickets from borrados;

  -- 4. Órdenes antiguas finalizadas (canceladas, fallidas, expiradas o con tickets ya borrados)
  with borrados as (
    delete from public.orders o
    where o.created_at < v_limite
      and (
        o.status in ('canceled', 'failed', 'expired')
        or not exists (select 1 from public.tickets t where t.order_id = o.id)
      )
    returning 1
  )
  select count(*) into v_ordenes from borrados;

  return query select v_webhooks, v_tickets, v_ordenes, v_cortesias;
end;
$$;

comment on function public.cleanup_old_records_90_days() is
  'Elimina registros de compras, tickets usados y webhooks con más de 90 días de antigüedad.';

revoke all on function public.cleanup_old_records_90_days() from public, anon, authenticated;
grant execute on function public.cleanup_old_records_90_days() to service_role;

-- Programar ejecución diaria si pg_cron está activo
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cleanup-records-90-days')
    where exists (select 1 from cron.job where jobname = 'cleanup-records-90-days');

    perform cron.schedule(
      'cleanup-records-90-days',
      '0 3 * * *', -- Todos los días a las 03:00 AM
      $cron$select * from public.cleanup_old_records_90_days()$cron$
    );
  end if;
exception
  when others then
    raise notice 'pg_cron no disponible; se puede invocar la función cleanup_old_records_90_days() periódicamente.';
end;
$$;
