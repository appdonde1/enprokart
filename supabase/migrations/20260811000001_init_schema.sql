-- Esquema base: eventos, secciones, mesas, sillas, órdenes, tickets, webhooks y staff.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- eventos

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  event_date timestamptz,
  venue text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- secciones

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null,
  label text not null,
  price_cents integer not null check (price_cents >= 0),
  has_seating boolean not null default true,
  assignment_mode text not null check (assignment_mode in ('manual', 'auto_fcfs', 'none')),
  capacity integer check (capacity is null or capacity > 0),
  sort_order integer not null default 0,
  theme_color text,
  notice text,
  created_at timestamptz not null default now(),
  unique (event_id, code)
);

comment on column public.sections.assignment_mode is
  'manual = el comprador elige mesa/silla; auto_fcfs = el backend asigna la próxima libre; none = sin asiento.';
comment on column public.sections.capacity is 'null = sin límite de cupo (área general).';
comment on column public.sections.notice is 'Aviso mostrado al comprador antes de confirmar la sección.';

-- ---------------------------------------------------------------- mesas

create table public.tables (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  number integer not null check (number > 0),
  seat_count integer not null check (seat_count between 0 and 40),
  pos_x integer,
  pos_y integer,
  label text,
  created_at timestamptz not null default now(),
  unique (section_id, number)
);

comment on column public.tables.pos_x is 'Columna en la grilla del editor visual admin (referencia: Plan Oro.jpg).';
comment on column public.tables.pos_y is 'Fila en la grilla del editor visual admin.';

create index idx_tables_section on public.tables (section_id);

-- ---------------------------------------------------------------- órdenes

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  table_id uuid,
  seat_id uuid,
  buyer_name text not null,
  buyer_lastname text not null,
  buyer_document text not null,
  buyer_whatsapp text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'canceled', 'failed')),
  pagarme_order_id text unique,
  pagarme_charge_id text,
  pix_qr_code text,
  pix_qr_code_url text,
  pix_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_status on public.orders (status);
create index idx_orders_event on public.orders (event_id);

-- ---------------------------------------------------------------- tickets

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  code text not null unique,
  qr_signature text not null,
  section_code text not null,
  section_label text not null,
  table_number integer,
  seat_number integer,
  buyer_name text not null,
  buyer_lastname text not null,
  buyer_document text not null,
  buyer_whatsapp text not null,
  status text not null default 'valid' check (status in ('valid', 'used', 'canceled')),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on column public.tickets.section_code is
  'Copia histórica: el ticket conserva qué compró aunque luego cambie la configuración del evento.';

create index idx_tickets_event on public.tickets (event_id);
create index idx_tickets_status on public.tickets (status);

-- ---------------------------------------------------------------- sillas

create table public.seats (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables (id) on delete cascade,
  number integer not null check (number > 0),
  status text not null default 'available' check (status in ('available', 'held', 'occupied')),
  held_by uuid references public.orders (id) on delete set null,
  held_until timestamptz,
  ticket_id uuid references public.tickets (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (table_id, number)
);

create index idx_seats_table on public.seats (table_id);
create index idx_seats_status on public.seats (status);
create index idx_seats_held_until on public.seats (held_until) where status = 'held';

alter table public.orders
  add constraint orders_table_fk foreign key (table_id) references public.tables (id) on delete set null,
  add constraint orders_seat_fk foreign key (seat_id) references public.seats (id) on delete set null;

-- ---------------------------------------------------------------- webhooks

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'pagarme',
  external_event_id text not null,
  payload jsonb,
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'error')),
  error_detail text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

-- ---------------------------------------------------------------- staff

create table public.staff_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'mesero' check (role in ('admin', 'mesero')),
  display_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

create trigger trg_seats_updated_at
  before update on public.seats
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- sillas <-> seat_count

-- Mantiene las filas de `seats` alineadas con `tables.seat_count`, para que el
-- stepper +/- del dashboard sea la única cosa que el admin tenga que tocar.
create or replace function public.sync_seats_for_table()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ocupadas integer;
begin
  if tg_op = 'UPDATE' and new.seat_count < old.seat_count then
    select count(*) into ocupadas
    from public.seats
    where table_id = new.id
      and number > new.seat_count
      and status <> 'available';

    if ocupadas > 0 then
      raise exception
        'No se puede reducir a % sillas: hay % silla(s) reservada(s) u ocupada(s) por encima de ese número.',
        new.seat_count, ocupadas
        using errcode = 'check_violation';
    end if;

    delete from public.seats where table_id = new.id and number > new.seat_count;
  end if;

  insert into public.seats (table_id, number)
  select new.id, generado
  from generate_series(1, new.seat_count) as generado
  on conflict (table_id, number) do nothing;

  return new;
end;
$$;

create trigger trg_tables_sync_seats
  after insert or update of seat_count on public.tables
  for each row execute function public.sync_seats_for_table();
