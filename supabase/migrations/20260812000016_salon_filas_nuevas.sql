-- Crecimiento del salón: una fila más en A y en B, dos filas más en C.
--
-- A y B pasan de 3 filas de 3 a 4 filas de 3: se suman A10-A12 y B10-B12.
--
-- C pasa de una fila de 9 a tres filas de 9, hacia el fondo. Cada fila tiene su
-- mesa única de 8 sillas en el centro: U1 adelante (la que ya existía como C5),
-- U2 en la fila del medio y U3 en la del fondo.
--
-- Las tres únicas viven cada una en su propia sección. El editor de precios del
-- panel trabaja por sección, así que ésa es la única forma de que el admin
-- pueda ponerle a U1, U2 y U3 un precio distinto a cada una —que es el pedido—.
-- Arrancan las tres con el precio que ya tenía la única, y de ahí en más las
-- mueve el panel.
--
-- Idempotente: se puede correr dos veces sin duplicar nada.

do $$
declare
  v_event    uuid;
  v_sec_a    uuid;
  v_sec_b    uuid;
  v_sec_c    uuid;
  v_precio_u integer;
  v_letra    text;
  v_sec      uuid;
  v_col      integer;
  v_fila     integer;
  v_num      integer;
  v_unica    uuid;
  v_i        integer;
begin
  select id into v_event from public.events where slug = 'noche-vip-fest';
  if v_event is null then
    raise notice 'No existe el evento noche-vip-fest: no hay nada que ampliar.';
    return;
  end if;

  -- Reconfigurar el salón con entradas ya vendidas dejaría gente sin su mesa.
  --
  -- La entrada no guarda el id de la mesa sino su código (`table_code`): se copia
  -- al emitirla justamente para que siga diciendo dónde se sentaba esa persona
  -- aunque el salón cambie después. Por eso la guarda mira el código y no una
  -- clave foránea, que no existe.
  if exists (
    select 1 from public.tickets t
    where t.event_id = v_event and t.table_code is not null
  ) then
    raise exception 'El evento ya tiene entradas emitidas con mesa asignada: ampliar el salón ahora movería lugares vendidos.';
  end if;

  select id into v_sec_a from public.sections where event_id = v_event and code = 'A';
  select id into v_sec_b from public.sections where event_id = v_event and code = 'B';
  select id into v_sec_c from public.sections where event_id = v_event and code = 'C';

  -- ------------------------------------------------ A y B: una fila más (fila 4)
  foreach v_letra in array array['A', 'B'] loop
    v_sec := case v_letra when 'A' then v_sec_a else v_sec_b end;
    if v_sec is null then continue; end if;

    for v_col in 1..3 loop
      v_num := 9 + v_col;   -- A10..A12 / B10..B12
      insert into public.tables (section_id, number, code, seat_count, pos_x, pos_y, label)
      values (v_sec, v_num, v_letra || v_num, 6, v_col, 4, null)
      on conflict (section_id, number) do nothing;
    end loop;

    -- La capacidad de la sección sube con las mesas nuevas.
    update public.sections
    set capacity = (
      select coalesce(sum(seat_count), 0) from public.tables where section_id = v_sec
    )
    where id = v_sec;
  end loop;

  -- ------------------------------------------------ C: dos filas más (filas 2 y 3)
  if v_sec_c is not null then
    -- La numeración sigue de corrido y saltea la columna 5, que es de la única.
    -- Fila 2: C10..C13 (col 1-4) y C14..C17 (col 6-9)
    -- Fila 3: C18..C21 (col 1-4) y C22..C25 (col 6-9)
    v_num := 9;
    for v_fila in 2..3 loop
      for v_col in 1..9 loop
        continue when v_col = 5;   -- el centro es de la mesa única
        v_num := v_num + 1;
        insert into public.tables (section_id, number, code, seat_count, pos_x, pos_y, label)
        values (v_sec_c, v_num, 'C' || v_num, 6, v_col, v_fila, null)
        on conflict (section_id, number) do nothing;
      end loop;
    end loop;

    update public.sections
    set capacity = (
      select coalesce(sum(seat_count), 0) from public.tables where section_id = v_sec_c
    )
    where id = v_sec_c;
  end if;

  -- ------------------------------------------------ las tres únicas
  -- La que ya existe pasa a llamarse U1 y se queda donde está: fila 1, centro.
  select price_cents into v_precio_u
  from public.sections where event_id = v_event and code = 'UNICA';
  v_precio_u := coalesce(v_precio_u, 25000);

  update public.sections
  set code = 'UNICA1', label = 'Mesa Única U1', sort_order = 3
  where event_id = v_event and code = 'UNICA';

  update public.tables m
  set code = 'U1', label = 'U1', seat_count = 8, pos_x = 5, pos_y = 1
  from public.sections s
  where s.id = m.section_id
    and s.event_id = v_event
    and s.code = 'UNICA1';

  -- U2 y U3: una sección por mesa, para que cada una tenga su propio precio.
  for v_i in 2..3 loop
    insert into public.sections
      (event_id, code, label, price_cents, has_seating, assignment_mode,
       capacity, sort_order, theme_color)
    values
      (v_event, 'UNICA' || v_i, 'Mesa Única U' || v_i, v_precio_u, true, 'manual',
       8, 3, '#d9b85d')
    on conflict (event_id, code) do nothing;

    select id into v_unica
    from public.sections where event_id = v_event and code = 'UNICA' || v_i;

    insert into public.tables (section_id, number, code, seat_count, pos_x, pos_y, label)
    values (v_unica, 1, 'U' || v_i, 8, 5, v_i, 'U' || v_i)
    on conflict (section_id, number) do nothing;
  end loop;
end $$;

-- El color de tema de la única vieja seguía en el ámbar de una paleta anterior.
update public.sections
set theme_color = '#d9b85d'
where code like 'UNICA%' and theme_color = '#ffb703';
