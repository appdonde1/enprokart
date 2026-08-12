-- Contenido de la portada: próximos eventos y productos destacados del menú.
--
-- Hasta ahora la portada listaba eventos y platos escritos a mano en el HTML.
-- Pasan a la base para que el admin los cambie desde el panel sin tocar código.

-- ---------------------------------------------------------------- eventos

alter table public.events
  add column if not exists event_type text,
  add column if not exists city text,
  add column if not exists city_code text,
  add column if not exists description text,
  add column if not exists is_main boolean not null default false,
  add column if not exists sells_tickets boolean not null default true;

comment on column public.events.event_type is 'Etiqueta corta de la portada: NIGHT RACE, CHALLENGE, SPECIAL...';
comment on column public.events.city_code is 'Sigla que se muestra en la fila del evento, ej. SP.';
comment on column public.events.is_main is
  'El evento que ocupa la portada y al que apunta el flujo de reserva.';
comment on column public.events.sells_tickets is
  'false para eventos que solo se anuncian y todavía no venden.';

-- Solo un evento puede ser el principal: evita que la portada quede ambigua.
create unique index if not exists events_un_solo_principal
  on public.events (is_main) where is_main;

-- ---------------------------------------------------------------- menú

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents integer check (price_cents is null or price_cents >= 0),
  category text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.menu_items.price_cents is
  'Nulo mientras no haya precio definido: la portada muestra "R$ —".';

alter table public.menu_items enable row level security;

grant select on public.menu_items to anon, authenticated;
grant insert, update, delete on public.menu_items to authenticated;

drop policy if exists "menu visible" on public.menu_items;
create policy "menu visible"
  on public.menu_items for select to anon, authenticated
  using (active or public.is_staff());

drop policy if exists "admin gestiona el menu" on public.menu_items;
create policy "admin gestiona el menu"
  on public.menu_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- datos iniciales

do $$
declare
  v_event uuid;
begin
  select id into v_event from public.events where slug = 'noche-vip-fest';
  if v_event is not null then
    update public.events
    set is_main = true,
        event_type = coalesce(event_type, 'NOCHE ESPECIAL'),
        city = coalesce(city, 'São Paulo'),
        city_code = coalesce(city_code, 'SP'),
        description = coalesce(description, 'Folklore · Gastronomía · Pista')
    where id = v_event;
  end if;
end;
$$;

insert into public.menu_items (name, description, price_cents, category, sort_order)
select * from (values
  ('Pro Burger',      'La clásica de la casa',        null::integer, 'Comida', 1),
  ('Pizza Paddock',   'Para compartir en la mesa',    null::integer, 'Comida', 2),
  ('Combo Race',      'Hamburguesa, papas y bebida',  null::integer, 'Combo',  3),
  ('Drinks & Softs',  'Bebidas frías y cócteles',     null::integer, 'Bebida', 4)
) as v(name, description, price_cents, category, sort_order)
where not exists (select 1 from public.menu_items);
