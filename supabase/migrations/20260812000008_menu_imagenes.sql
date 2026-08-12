-- Cada producto del menú puede llevar su propia foto.
alter table public.menu_items add column if not exists image_url text;

comment on column public.menu_items.image_url is
  'Archivo servido junto al sitio, ej. "menu/pizza.jpg". Vacío = placeholder.';
