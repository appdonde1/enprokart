-- Productos del "Menú destacado".
--
-- Son marcadores de posición: quedan sin precio y sin descripción a propósito,
-- para que el admin los complete desde el panel cuando estén definidos.

delete from public.menu_items
where name in ('Pro Burger', 'Pizza Paddock', 'Combo Race', 'Drinks & Softs');

insert into public.menu_items (name, description, price_cents, category, sort_order, active)
select v.name, null, null, v.category, v.sort_order, true
from (values
  ('Pizza Prokart',           'Comida', 1),
  ('Parrilla Prokart',        'Comida', 2),
  ('Hamburguesa Prokart',     'Comida', 3),
  ('Tenders de Pollo Prokart','Comida', 4)
) as v(name, category, sort_order)
where not exists (
  select 1 from public.menu_items m where m.name = v.name
);
