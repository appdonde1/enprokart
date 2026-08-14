-- Diagnóstico temporal: deja en una tabla qué extensiones y trabajos de cron
-- hay, para poder leerlo desde fuera. Se borra en la migración siguiente.
create table if not exists public.diag_cron (
  clave text primary key,
  valor text
);
alter table public.diag_cron enable row level security;
drop policy if exists "diag lectura" on public.diag_cron;
create policy "diag lectura" on public.diag_cron for select to anon using (true);

truncate public.diag_cron;

insert into public.diag_cron (clave, valor)
select 'pg_cron', case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'sí' else 'no' end;

insert into public.diag_cron (clave, valor)
select 'pg_net', case when exists (select 1 from pg_extension where extname = 'pg_net') then 'sí' else 'no' end;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    insert into public.diag_cron (clave, valor)
    select 'trabajos', coalesce(string_agg(jobname || ' [' || schedule || '] ' || command, ' | '), '(ninguno)')
    from cron.job;
  end if;
end;
$$;
