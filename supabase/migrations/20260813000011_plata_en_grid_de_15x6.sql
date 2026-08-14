-- La Sección Plata pasa de 9 columnas por 10 filas a 15 por 6.
--
-- Son las mismas 90 mesas: no se agrega ni se quita ninguna, solo se reacomodan.
-- P1 sigue siendo P1 y quien tenga una entrada con su código la conserva; lo
-- único que cambia es dónde se dibuja en el plano.
--
-- El orden se mantiene de lectura: P1 arriba a la izquierda, P15 cierra la
-- primera fila, P16 abre la segunda.

do $$
declare
  v_seccion uuid;
  v_evento  uuid;
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

  -- Reacomodar mesas ya vendidas movería a alguien de lugar sin avisarle.
  -- La entrada no guarda el id de la mesa sino su sección y su código, así que
  -- se pregunta por la sección.
  if exists (
    select 1 from public.tickets t
    where t.section_id = v_seccion and t.status <> 'canceled'
  ) then
    raise exception 'Plata ya tiene entradas emitidas con mesa asignada: reacomodar el grid movería lugares vendidos.';
  end if;

  -- `number` es el orden con el que se crearon y es lo que define la posición.
  update public.tables m
  set pos_x = ((m.number - 1) % 15) + 1,
      pos_y = ((m.number - 1) / 15) + 1
  where m.section_id = v_seccion;

  update public.sections
  set capacity = (
    select coalesce(sum(seat_count), 0) from public.tables where section_id = v_seccion
  )
  where id = v_seccion;
end $$;
