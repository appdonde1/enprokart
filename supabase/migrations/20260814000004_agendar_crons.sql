-- Agenda las dos funciones que tienen que correr solas.
--
-- 1. `expire-holds` cada 5 minutos: suelta las reservas vencidas y, sobre todo,
--    cancela sus cobranzas en Asaas. Estaba escrita desde hace días pero nunca
--    se agendó, y se notaba: de las 32 cobranzas canceladas hasta hoy, las 32
--    las canceló el barrido de `create-order`, que solo corre cuando entra una
--    compra nueva. En una noche sin tráfico un QR vencido queda vivo hasta las
--    23:59 y alguien puede pagar una mesa que ya se revendió.
--
-- 2. `reporte-semanal` los lunes a las 15:00 UTC, que son las 11:00 en Boa
--    Vista y en Venezuela (los dos UTC-4, sin horario de verano).
--
-- El secreto que autentica esas llamadas se genera acá adentro y se queda en la
-- base. No va en este archivo a propósito: una migración con un secreto adentro
-- queda en git para siempre y rotarlo obligaría a reescribir la historia.

-- ---------------------------------------------------------------- extensiones

create extension if not exists pg_cron;
-- pg_net es lo que permite llamar a una Edge Function desde SQL. Sin esto,
-- pg_cron solo puede correr SQL puro y no hay forma de hablar con Asaas.
create extension if not exists pg_net;

-- ---------------------------------------------------------------- el secreto

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table if not exists privado.secretos (
  nombre text primary key,
  valor text not null,
  creado_en timestamptz not null default now()
);

revoke all on privado.secretos from public, anon, authenticated;

/* RLS sin políticas: niega todo.
   Hoy es redundante —`privado` no está entre los esquemas que expone la Data
   API, así que PostgREST no llega ni con la anon key, y el `revoke` de arriba
   ya sacó el permiso—, pero es una tabla con un secreto adentro y merece la
   segunda barrera: si alguien mañana expone el esquema o concede un permiso de
   más, esto sigue cerrado.

   No afecta a quien tiene que leerla. RLS no se le aplica al dueño de la tabla
   (no se usa `force`), así que `secreto_cron()`, que es `security definer` y
   corre como postgres, y el job de pg_cron, que también corre como postgres,
   siguen viendo el valor. `service_role` además tiene BYPASSRLS. */
alter table privado.secretos enable row level security;

-- `on conflict do nothing`: si la migración se vuelve a aplicar, el secreto no
-- cambia. Rotarlo es un borrado explícito, nunca un efecto secundario.
insert into privado.secretos (nombre, valor)
values ('cron', encode(gen_random_bytes(32), 'hex'))
on conflict (nombre) do nothing;

/* Lo que leen las Edge Functions para validar la cabecera `x-cron-secret`.
   Es `security definer` porque `privado` no le está expuesto a nadie, y solo
   `service_role` puede ejecutarla: el navegador nunca llega acá. */
create or replace function public.secreto_cron()
returns text
language sql
security definer
set search_path = privado
as $$ select valor from privado.secretos where nombre = 'cron' $$;

revoke all on function public.secreto_cron() from public, anon, authenticated;
grant execute on function public.secreto_cron() to service_role;

comment on function public.secreto_cron() is
  'Secreto compartido con pg_cron para llamar a expire-holds y reporte-semanal.';

-- ---------------------------------------------------------------- los cron

do $$
declare
  v_base text := 'https://tgilgfwxtghcqskfyzif.supabase.co/functions/v1/';
begin
  -- Se desagenda primero para que aplicar la migración dos veces no deje dos
  -- jobs iguales corriendo en paralelo.
  perform cron.unschedule('expire-holds-cada-5-min')
  where exists (select 1 from cron.job where jobname = 'expire-holds-cada-5-min');

  perform cron.unschedule('reporte-semanal-lunes')
  where exists (select 1 from cron.job where jobname = 'reporte-semanal-lunes');

  perform cron.schedule(
    'expire-holds-cada-5-min',
    '*/5 * * * *',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select valor from privado.secretos where nombre = 'cron')
        ),
        timeout_milliseconds := 20000
      )
      $cron$,
      v_base || 'expire-holds'
    )
  );

  -- Lunes 15:00 UTC = 11:00 UTC-4.
  perform cron.schedule(
    'reporte-semanal-lunes',
    '0 15 * * 1',
    format(
      $cron$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select valor from privado.secretos where nombre = 'cron')
        ),
        timeout_milliseconds := 60000
      )
      $cron$,
      v_base || 'reporte-semanal'
    )
  );
end;
$$;
