-- Datos del evento actual. Idempotente: re-ejecutarla no duplica ni pisa precios
-- que el admin haya cambiado desde el dashboard.
-- Las filas de `seats` las crea el trigger trg_tables_sync_seats al insertar las mesas.

insert into public.events (slug, name, event_date, venue, status)
values ('noche-vip-fest', 'Noche VIP Fest', '2026-12-20 21:00:00-03', 'Arena Central', 'published')
on conflict (slug) do nothing;

insert into public.sections
  (event_id, code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color, notice)
select
  e.id, v.code, v.label, v.price_cents, v.has_seating, v.assignment_mode,
  v.capacity, v.sort_order, v.theme_color, v.notice
from public.events e
cross join (values
  ('UNICA',     'Mesa Única (VIP)', 25000, true,  'manual',    8,    1, '#d4af37',
   null),
  ('ORO',       'Área Oro (VIP)',   15000, true,  'manual',    48,   2, '#d4af37',
   null),
  ('VIP_PLATA', 'VIP Plata',        10000, true,  'auto_fcfs', 480,  3, '#c0c0c8',
   'Esta sección funciona con la asignación de mesas por orden de llegada'),
  ('GENERAL',   'Área General',      5000, false, 'none',      null, 4, '#3aa0ff',
   'Acceso de pie, sin mesa ni silla asignada')
) as v(code, label, price_cents, has_seating, assignment_mode, capacity, sort_order, theme_color, notice)
where e.slug = 'noche-vip-fest'
on conflict (event_id, code) do nothing;

-- Mesa Única: una sola mesa de 8 sillas.
insert into public.tables (section_id, number, seat_count, pos_x, pos_y, label)
select s.id, 1, 8, 1, 1, 'Única'
from public.sections s
join public.events e on e.id = s.event_id
where e.slug = 'noche-vip-fest' and s.code = 'UNICA'
on conflict (section_id, number) do nothing;

-- Oro: 8 mesas de 6 sillas en grilla de 4x2.
insert into public.tables (section_id, number, seat_count, pos_x, pos_y)
select s.id, n, 6, ((n - 1) % 4) + 1, ((n - 1) / 4) + 1
from public.sections s
join public.events e on e.id = s.event_id
cross join generate_series(1, 8) as n
where e.slug = 'noche-vip-fest' and s.code = 'ORO'
on conflict (section_id, number) do nothing;

-- VIP Plata: 120 mesas de 4 sillas (480 lugares) en grilla de 12x10.
-- El comprador nunca ve esta grilla; existe para el editor visual del dashboard
-- y para que la asignación por orden de llegada tenga un orden estable.
insert into public.tables (section_id, number, seat_count, pos_x, pos_y)
select s.id, n, 4, ((n - 1) % 12) + 1, ((n - 1) / 12) + 1
from public.sections s
join public.events e on e.id = s.event_id
cross join generate_series(1, 120) as n
where e.slug = 'noche-vip-fest' and s.code = 'VIP_PLATA'
on conflict (section_id, number) do nothing;
