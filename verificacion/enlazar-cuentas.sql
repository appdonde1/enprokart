-- Enlaza los legajos con las cuentas de acceso, por correo.
--
-- Es el mismo bloque que corre al final de `20260812000015_personal.sql`. Vive
-- aparte porque las cuentas de `auth.users` se crean a mano desde el panel de
-- Supabase, y puede que todavía no existieran cuando la migración se aplicó. Se
-- puede correr las veces que haga falta: no duplica nada.
--
-- Dónde pegarlo: Supabase → SQL Editor → New query → Run.

do $$
declare
  v_duenio uuid;
  v_uid uuid;
  v_persona record;
begin
  select id into v_duenio from public.credenciales where nombre = 'Dueño';

  select id into v_uid from auth.users where lower(email) = 'developer@enprokart.com';

  if v_uid is null then
    raise notice 'No existe developer@enprokart.com todavía. Creala en Authentication → Add user.';
  else
    insert into public.staff_profiles (id, email, role, display_name, must_change_password, admin_code)
    values (v_uid, 'developer@enprokart.com', 'developer', 'Desarrollo',
            true, (100 + floor(random() * 900))::int::text)
    on conflict (id) do update
      set role = 'developer',
          admin_code = coalesce(staff_profiles.admin_code,
                                (100 + floor(random() * 900))::int::text);
    raise notice 'developer@enprokart.com quedó con rol developer.';
  end if;

  -- Los correos llevan la inicial del apellido: así están cargados en
  -- `auth.users`. Sin la inicial, el legajo se crea igual pero queda sin cuenta.
  for v_persona in
    select * from (values
      ('betsimart@enprokart.com', 'Betsimar', 'Quintero'),
      ('jonathang@enprokart.com', 'Jonathan', 'González')
    ) as p(correo, nombre, apellido)
  loop
    select id into v_uid from auth.users where lower(email) = v_persona.correo;

    if v_uid is null then
      raise notice 'No existe % todavía: su legajo queda sin cuenta enlazada.', v_persona.correo;
    end if;

    -- El legajo se crea si falta; si ya está, solo se le engancha la cuenta.
    -- La guarda es explícita porque el correo no tiene índice único: sin ella,
    -- correr esto dos veces dejaría dos legajos de la misma persona.
    insert into public.empleados (nombre, apellido, email, credencial_id, staff_id, fecha_ingreso)
    select v_persona.nombre, v_persona.apellido, v_persona.correo, v_duenio, v_uid, current_date
    where not exists (
      select 1 from public.empleados where lower(email) = v_persona.correo
    );

    if v_uid is not null then
      update public.empleados
         set staff_id = v_uid, updated_at = now()
       where lower(email) = v_persona.correo and staff_id is null;
    end if;
  end loop;
end;
$$;

-- Para leer el código de administrador de 3 dígitos de la cuenta de desarrollo,
-- que hace falta para firmar ajustes de nómina. También se ve desde el panel, en
-- Usuarios, con la sesión de esa cuenta abierta.
select p.email, p.role, p.admin_code, p.must_change_password
  from public.staff_profiles p
 where p.role in ('developer', 'admin')
 order by p.role, p.email;
