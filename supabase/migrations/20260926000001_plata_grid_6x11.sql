-- La Sección Plata pasa de 15x6 (90 mesas) a 11x6 (66 mesas: 6 filas por 11 columnas).
--
-- Se preservan en primera fila (pos_y = 1) todas las mesas que ya fueron vendidas
-- (P7, P8, P9, P11, P12) para garantizar la ubicación a los compradores.
-- Las mesas > 66 que no tienen ventas se eliminan y la capacidad se actualiza a 264 lugares (66 x 4).

do $$
declare
  v_evento  uuid;
  v_seccion uuid;
begin
  select id into v_evento from public.events where slug = 'noche-vip-fest';
  if v_evento is null then
    raise notice 'No existe el evento: no hay nada que reacomodar.';
    return;
  end if;

  select id into v_seccion
  from public.sections
  where event_id = v_evento and code = 'PLATA';

  if v_seccion is null then
    raise notice 'No existe la sección PLATA.';
    return;
  end if;

  -- 1. Eliminar mesas libres por encima de 66
  delete from public.tables
  where section_id = v_seccion
    and number > 66
    and not exists (
      select 1 from public.tickets t
      where t.section_id = v_seccion
        and t.table_code = tables.code
        and t.status <> 'canceled'
    );

  -- 2. Fila 1 (pos_y = 1): 11 mesas incluyendo las 5 vendidas (P7, P8, P9, P11, P12)
  update public.tables set pos_x = 1,  pos_y = 1 where section_id = v_seccion and code = 'P1';
  update public.tables set pos_x = 2,  pos_y = 1 where section_id = v_seccion and code = 'P2';
  update public.tables set pos_x = 3,  pos_y = 1 where section_id = v_seccion and code = 'P3';
  update public.tables set pos_x = 4,  pos_y = 1 where section_id = v_seccion and code = 'P4';
  update public.tables set pos_x = 5,  pos_y = 1 where section_id = v_seccion and code = 'P5';
  update public.tables set pos_x = 6,  pos_y = 1 where section_id = v_seccion and code = 'P6';
  update public.tables set pos_x = 7,  pos_y = 1 where section_id = v_seccion and code = 'P7';
  update public.tables set pos_x = 8,  pos_y = 1 where section_id = v_seccion and code = 'P8';
  update public.tables set pos_x = 9,  pos_y = 1 where section_id = v_seccion and code = 'P9';
  update public.tables set pos_x = 10, pos_y = 1 where section_id = v_seccion and code = 'P11';
  update public.tables set pos_x = 11, pos_y = 1 where section_id = v_seccion and code = 'P12';

  -- 3. Fila 2 (pos_y = 2): 11 mesas (P10, P13, P14, P15 libres de la fila anterior + P16..P22)
  update public.tables set pos_x = 1,  pos_y = 2 where section_id = v_seccion and code = 'P10';
  update public.tables set pos_x = 2,  pos_y = 2 where section_id = v_seccion and code = 'P13';
  update public.tables set pos_x = 3,  pos_y = 2 where section_id = v_seccion and code = 'P14';
  update public.tables set pos_x = 4,  pos_y = 2 where section_id = v_seccion and code = 'P15';
  update public.tables set pos_x = 5,  pos_y = 2 where section_id = v_seccion and code = 'P16';
  update public.tables set pos_x = 6,  pos_y = 2 where section_id = v_seccion and code = 'P17';
  update public.tables set pos_x = 7,  pos_y = 2 where section_id = v_seccion and code = 'P18';
  update public.tables set pos_x = 8,  pos_y = 2 where section_id = v_seccion and code = 'P19';
  update public.tables set pos_x = 9,  pos_y = 2 where section_id = v_seccion and code = 'P20';
  update public.tables set pos_x = 10, pos_y = 2 where section_id = v_seccion and code = 'P21';
  update public.tables set pos_x = 11, pos_y = 2 where section_id = v_seccion and code = 'P22';

  -- 4. Fila 3 (pos_y = 3): P23..P33
  update public.tables set pos_x = 1,  pos_y = 3 where section_id = v_seccion and code = 'P23';
  update public.tables set pos_x = 2,  pos_y = 3 where section_id = v_seccion and code = 'P24';
  update public.tables set pos_x = 3,  pos_y = 3 where section_id = v_seccion and code = 'P25';
  update public.tables set pos_x = 4,  pos_y = 3 where section_id = v_seccion and code = 'P26';
  update public.tables set pos_x = 5,  pos_y = 3 where section_id = v_seccion and code = 'P27';
  update public.tables set pos_x = 6,  pos_y = 3 where section_id = v_seccion and code = 'P28';
  update public.tables set pos_x = 7,  pos_y = 3 where section_id = v_seccion and code = 'P29';
  update public.tables set pos_x = 8,  pos_y = 3 where section_id = v_seccion and code = 'P30';
  update public.tables set pos_x = 9,  pos_y = 3 where section_id = v_seccion and code = 'P31';
  update public.tables set pos_x = 10, pos_y = 3 where section_id = v_seccion and code = 'P32';
  update public.tables set pos_x = 11, pos_y = 3 where section_id = v_seccion and code = 'P33';

  -- 5. Fila 4 (pos_y = 4): P34..P44
  update public.tables set pos_x = 1,  pos_y = 4 where section_id = v_seccion and code = 'P34';
  update public.tables set pos_x = 2,  pos_y = 4 where section_id = v_seccion and code = 'P35';
  update public.tables set pos_x = 3,  pos_y = 4 where section_id = v_seccion and code = 'P36';
  update public.tables set pos_x = 4,  pos_y = 4 where section_id = v_seccion and code = 'P37';
  update public.tables set pos_x = 5,  pos_y = 4 where section_id = v_seccion and code = 'P38';
  update public.tables set pos_x = 6,  pos_y = 4 where section_id = v_seccion and code = 'P39';
  update public.tables set pos_x = 7,  pos_y = 4 where section_id = v_seccion and code = 'P40';
  update public.tables set pos_x = 8,  pos_y = 4 where section_id = v_seccion and code = 'P41';
  update public.tables set pos_x = 9,  pos_y = 4 where section_id = v_seccion and code = 'P42';
  update public.tables set pos_x = 10, pos_y = 4 where section_id = v_seccion and code = 'P43';
  update public.tables set pos_x = 11, pos_y = 4 where section_id = v_seccion and code = 'P44';

  -- 6. Fila 5 (pos_y = 5): P45..P55
  update public.tables set pos_x = 1,  pos_y = 5 where section_id = v_seccion and code = 'P45';
  update public.tables set pos_x = 2,  pos_y = 5 where section_id = v_seccion and code = 'P46';
  update public.tables set pos_x = 3,  pos_y = 5 where section_id = v_seccion and code = 'P47';
  update public.tables set pos_x = 4,  pos_y = 5 where section_id = v_seccion and code = 'P48';
  update public.tables set pos_x = 5,  pos_y = 5 where section_id = v_seccion and code = 'P49';
  update public.tables set pos_x = 6,  pos_y = 5 where section_id = v_seccion and code = 'P50';
  update public.tables set pos_x = 7,  pos_y = 5 where section_id = v_seccion and code = 'P51';
  update public.tables set pos_x = 8,  pos_y = 5 where section_id = v_seccion and code = 'P52';
  update public.tables set pos_x = 9,  pos_y = 5 where section_id = v_seccion and code = 'P53';
  update public.tables set pos_x = 10, pos_y = 5 where section_id = v_seccion and code = 'P54';
  update public.tables set pos_x = 11, pos_y = 5 where section_id = v_seccion and code = 'P55';

  -- 7. Fila 6 (pos_y = 6): P56..P66
  update public.tables set pos_x = 1,  pos_y = 6 where section_id = v_seccion and code = 'P56';
  update public.tables set pos_x = 2,  pos_y = 6 where section_id = v_seccion and code = 'P57';
  update public.tables set pos_x = 3,  pos_y = 6 where section_id = v_seccion and code = 'P58';
  update public.tables set pos_x = 4,  pos_y = 6 where section_id = v_seccion and code = 'P59';
  update public.tables set pos_x = 5,  pos_y = 6 where section_id = v_seccion and code = 'P60';
  update public.tables set pos_x = 6,  pos_y = 6 where section_id = v_seccion and code = 'P61';
  update public.tables set pos_x = 7,  pos_y = 6 where section_id = v_seccion and code = 'P62';
  update public.tables set pos_x = 8,  pos_y = 6 where section_id = v_seccion and code = 'P63';
  update public.tables set pos_x = 9,  pos_y = 6 where section_id = v_seccion and code = 'P64';
  update public.tables set pos_x = 10, pos_y = 6 where section_id = v_seccion and code = 'P65';
  update public.tables set pos_x = 11, pos_y = 6 where section_id = v_seccion and code = 'P66';

  -- 8. Actualizar capacidad de la sección
  update public.sections
  set capacity = (
    select coalesce(sum(seat_count), 0) from public.tables where section_id = v_seccion
  )
  where id = v_seccion;

end $$;
