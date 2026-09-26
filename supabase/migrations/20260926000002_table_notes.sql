-- Descripciones y notas personalizadas para mesas por evento

alter table public.orders add column if not exists notes text;

create table if not exists public.table_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  table_code text not null,
  notes text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (event_id, table_code)
);

alter table public.table_notes enable row level security;

drop policy if exists "staff ve notas de mesas" on public.table_notes;
create policy "staff ve notas de mesas"
  on public.table_notes for select to authenticated
  using (public.is_staff());

drop policy if exists "admin edita notas de mesas" on public.table_notes;
create policy "admin edita notas de mesas"
  on public.table_notes for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.table_notes to authenticated;
