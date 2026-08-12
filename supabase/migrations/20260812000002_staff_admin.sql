-- Gestión de personal: cambio de clave obligatorio, código de administrador y
-- entradas de cortesía.

alter table public.staff_profiles
  add column if not exists email text,
  add column if not exists must_change_password boolean not null default true,
  add column if not exists admin_code text,
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists last_password_change timestamptz;

comment on column public.staff_profiles.must_change_password is
  'Mientras sea true el panel bloquea todo hasta que la persona cambie su clave.';
comment on column public.staff_profiles.admin_code is
  'PIN de 3 dígitos que confirma acciones sensibles. No es la autenticación: el
   panel ya exige sesión con rol admin, esto solo evita el clic accidental o
   que alguien use una sesión abierta ajena.';

-- Entradas emitidas sin cobro, autorizadas por un admin.
alter table public.tickets
  add column if not exists is_courtesy boolean not null default false,
  add column if not exists issued_by uuid references auth.users (id) on delete set null;

alter table public.orders
  add column if not exists is_courtesy boolean not null default false;

-- Registro de cada cortesía emitida, para poder auditar quién regaló qué.
create table if not exists public.courtesy_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets (id) on delete set null,
  issued_by uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.courtesy_log enable row level security;

create policy "admin ve cortesias"
  on public.courtesy_log for select to authenticated
  using (public.is_admin());

grant select on public.courtesy_log to authenticated;

-- `admin_code` no debe poder leerse ni siquiera desde el panel: solo se
-- compara dentro de una Edge Function con service_role.
revoke select on public.staff_profiles from anon, authenticated;

grant select (id, role, display_name, email, must_change_password, created_at)
  on public.staff_profiles to authenticated;

-- Cada quien puede marcar que ya cambió su propia clave; el resto lo maneja
-- una Edge Function.
grant update (must_change_password, last_password_change)
  on public.staff_profiles to authenticated;

drop policy if exists "staff actualiza su propio perfil" on public.staff_profiles;
create policy "staff actualiza su propio perfil"
  on public.staff_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
