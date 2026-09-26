-- Secciones A y B: 4 columnas por 3 filas, no 3 por 4.
--
-- El salón tiene las mesas así:
--
--      1   2   3   4
--      5   6   7   8
--      9  10  11  12
--
-- y la base las tenía transpuestas: `pos_x` llegaba hasta 3 y `pos_y` hasta 4,
-- o sea tres mesas por fila y cuatro filas.
--
-- No era un fallo de dibujo. El sitio y el panel calculan las columnas igual
-- —`max(pos_x)`— así que los dos pintaban 3x4 con total fidelidad a un dato
-- equivocado. Por eso no se arregla en el CSS: se arregla acá.
--
-- La fórmula es la misma que ya usa el seed original para Oro y para Plata
-- (20260811000005_seed_event.sql:38 y :49), solo que con cuatro columnas:
--
--      pos_x = ((n - 1) % 4) + 1
--      pos_y = ((n - 1) / 4) + 1
--
-- `number` es la columna que ya guarda el orden de la mesa dentro de su
-- sección, así que la posición se deriva de él y no del texto del código: si
-- mañana alguien renombra "A7" a "A-07", esto sigue funcionando.

update public.tables t
set
  pos_x = ((t.number - 1) % 4) + 1,
  pos_y = ((t.number - 1) / 4) + 1
from public.sections s
join public.events e on e.id = s.event_id
where t.section_id = s.id
  and s.code in ('A', 'B')
  and e.slug = 'noche-vip-fest';

-- Comprobación: las dos secciones tienen que quedar en 4 x 3. Si alguna no
-- cuadra, la migración falla acá en vez de dejar el salón a medio corregir.
do $$
declare
  mal record;
begin
  for mal in
    select s.code,
           max(t.pos_x) as columnas,
           max(t.pos_y) as filas,
           count(*)     as mesas
    from public.tables t
    join public.sections s on s.id = t.section_id
    join public.events e on e.id = s.event_id
    where s.code in ('A', 'B') and e.slug = 'noche-vip-fest'
    group by s.code
    having max(t.pos_x) <> 4 or max(t.pos_y) <> 3
  loop
    raise exception
      'Sección % quedó en % x % con % mesas; se esperaba 4 x 3.',
      mal.code, mal.columnas, mal.filas, mal.mesas;
  end loop;
end $$;
