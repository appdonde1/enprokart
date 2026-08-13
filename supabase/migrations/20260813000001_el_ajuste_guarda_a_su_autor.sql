-- El ajuste de nómina guarda el nombre de quien lo hizo, y suelta la llave.
--
-- `nomina_ajustes.hecho_por` apuntaba a `auth.users` con `on delete set null`.
-- Eso parecía inofensivo hasta que se intentó eliminar una cuenta: el SET NULL
-- es un UPDATE sobre la fila del ajuste, y el trigger de inmutabilidad lo
-- rechaza. Resultado: una cuenta que alguna vez tocó un sueldo no se podía
-- eliminar, y `staff-admin` fallaba a mitad de camino dejando el perfil borrado
-- y el usuario de auth vivo.
--
-- Las dos reglas eran correctas por separado y se contradecían juntas. Gana la
-- del registro: un ajuste no se reescribe nunca. Así que en vez de que la fila
-- dependa de una cuenta viva, se copia el nombre del autor al momento de
-- hacerlo, igual que la línea de nómina copia el nombre del empleado al cerrar
-- la semana y que la entrada emitida copia su sección y su mesa.
--
-- `hecho_por` se queda como uuid suelto, sin llave: sigue sirviendo para
-- rastrear a la persona mientras la cuenta exista, y deja de poder bloquear su
-- eliminación.

alter table public.nomina_ajustes
  add column if not exists hecho_por_nombre text;

comment on column public.nomina_ajustes.hecho_por_nombre is
  'Quién hizo el ajuste, copiado al hacerlo. Es lo que hace que el registro
   sobreviva a la eliminación de la cuenta: sin esto, borrar a un administrador
   dejaría ajustes sin autor y la auditoría no podría reconstruir quién cambió
   un sueldo.';

comment on column public.nomina_ajustes.hecho_por is
  'Id de la cuenta, sin llave foránea a propósito: una fila que no se puede
   actualizar tampoco puede recibir el `set null` de un borrado.';

-- Lo ya cargado se completa con el nombre que hoy tenga la cuenta.
--
-- El trigger de inmutabilidad bloquea también este UPDATE, que es exactamente
-- la señal de que hace su trabajo. Se apaga y se vuelve a encender dentro de la
-- misma transacción: no hay ningún instante en que la nómina quede sin guarda,
-- y si algo falla, el rollback deja el trigger como estaba.
alter table public.nomina_ajustes disable trigger nomina_ajustes_sin_retoques;

update public.nomina_ajustes a
   set hecho_por_nombre = coalesce(p.display_name, p.email)
  from public.staff_profiles p
 where p.id = a.hecho_por
   and a.hecho_por_nombre is null;

alter table public.nomina_ajustes enable trigger nomina_ajustes_sin_retoques;

-- El nombre de la restricción lo puso Postgres al crearla; se busca en vez de
-- suponerlo, para que esto valga aunque la tabla se haya creado en otro orden.
do $$
declare
  v_nombre text;
begin
  select conname into v_nombre
    from pg_constraint
   where conrelid = 'public.nomina_ajustes'::regclass
     and contype = 'f'
     and conkey = array[
       (select attnum from pg_attribute
         where attrelid = 'public.nomina_ajustes'::regclass and attname = 'hecho_por')
     ];

  if v_nombre is not null then
    execute format('alter table public.nomina_ajustes drop constraint %I', v_nombre);
  end if;
end;
$$;
