-- Libera cada minuto las sillas cuyo PIX venció sin pagarse.
-- Si pg_cron no está habilitado en el proyecto, esta migración no falla: en ese caso
-- se agenda la Edge Function `expire-holds` desde el panel (Edge Functions > Cron).

do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron no disponible; agendar la Edge Function expire-holds desde el panel.';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-pending-holds')
    where exists (select 1 from cron.job where jobname = 'expire-pending-holds');

    perform cron.schedule(
      'expire-pending-holds',
      '* * * * *',
      $cron$select public.expire_pending_holds()$cron$
    );
  end if;
end;
$$;
