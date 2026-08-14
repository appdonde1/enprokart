-- Plata pasa a elegirse en el plano: 90 mesas, detrás de la Sección C.
--
-- Hasta ahora Plata se asignaba por orden de llegada y su mapa no se mostraba a
-- nadie: el comprador pagaba sin saber dónde se iba a sentar. Ahora elige, igual
-- que en Oro. Son 90 mesas de 4 sillas —360 lugares— en una grilla de 9 columnas
-- por 10 filas, alineada con las nueve columnas de la Sección C, que es lo que
-- tiene delante en el salón.
--
-- Las 120 que había se recortan a 90. No se pierde nada vendido: la guarda de
-- abajo aborta si alguna entrada ya tiene mesa asignada.
--
-- Idempotente: se puede correr dos veces sin duplicar nada.

do $$
declare
  v_event uuid;
  v_plata uuid;
  v_col   integer;
  v_fila  integer;
  v_num   integer;
begin
  select id into v_event from public.events where slug = 'noche-vip-fest';
  if v_event is null then
    raise notice 'No existe el evento noche-vip-fest: no hay nada que cambiar.';
    return;
  end if;

  -- Reconfigurar el salón con entradas ya vendidas dejaría gente sin su mesa.
  -- La entrada guarda el código de la mesa, no su id, así que la guarda mira el
  -- código: es lo que sigue diciendo dónde se sentaba alguien.
  if exists (
    select 1 from public.tickets t
    where t.event_id = v_event and t.table_code is not null
  ) then
    raise exception 'El evento ya tiene entradas emitidas con mesa asignada: recortar Plata ahora movería lugares vendidos.';
  end if;

  select id into v_plata
  from public.sections where event_id = v_event and code = 'PLATA';

  if v_plata is null then
    raise notice 'No existe la sección PLATA.';
    return;
  end if;

  -- ------------------------------------------------ de 120 a 90
  --
  -- `on delete cascade` de `seats` se lleva las sillas de las mesas que se van.
  -- Si alguna estuviera tomada, la guarda de arriba ya habría abortado.
  delete from public.tables
   where section_id = v_plata and number > 90;

  -- ------------------------------------------------ la grilla, 9 × 10
  --
  -- Nueve columnas para que quede a plomo con la Sección C, que es la fila de
  -- mesas que Plata tiene delante. La numeración corre por filas, de adelante
  -- hacia el fondo: P1 es la más cercana a la tarima.
  v_num := 0;
  for v_fila in 1..10 loop
    for v_col in 1..9 loop
      v_num := v_num + 1;

      insert into public.tables (section_id, number, code, seat_count, pos_x, pos_y, label)
      values (v_plata, v_num, 'P' || v_num, 4, v_col, v_fila, null)
      on conflict (section_id, number) do update
        set code = excluded.code,
            seat_count = excluded.seat_count,
            pos_x = excluded.pos_x,
            pos_y = excluded.pos_y;
    end loop;
  end loop;

  -- ------------------------------------------------ se elige, no se asigna
  --
  -- `manual` es lo que hace que la mesa se pueda tocar: el frontend solo carga
  -- el plano de las secciones manuales, y `create-order` solo acepta
  -- `table_codes` para ellas. Cambiar esto es lo que convierte a Plata de una
  -- bolsa de lugares en un mapa.
  update public.sections
     set assignment_mode = 'manual',
         capacity = (select coalesce(sum(seat_count), 0)
                       from public.tables where section_id = v_plata)
   where id = v_plata;
end;
$$;

comment on column public.sections.assignment_mode is
  'manual = el comprador elige su mesa en el plano; auto_fcfs = se le asigna por
   orden de llegada; none = sin asiento. Es lo que decide el comportamiento, no
   el nombre de la sección: el panel y el sitio se arman con esto.';
