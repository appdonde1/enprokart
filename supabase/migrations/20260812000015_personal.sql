-- Abre la administración de la gente: áreas, credenciales, legajos y nómina.
--
-- La separación que ordena todo esto: el legajo de un empleado NO es una cuenta
-- de acceso. Alguien de cocina o de limpieza tiene ficha y sueldo pero nunca
-- entra al panel; un mesonero tiene ficha y además acceso. Mezclarlos crearía
-- decenas de cuentas que nadie usa, y cada cuenta viva es una puerta más en un
-- sistema que mueve dinero.
--
-- Las tablas de acá guardan cédulas, direcciones, teléfonos y sueldos. Ninguna
-- recibe grant: se leen y escriben solo con service_role desde una Edge Function
-- que ya verificó el rol. Es el mismo criterio con el que se cerraron `orders` y
-- `tickets` en `20260812000009_quitar_security_definer.sql`.

-- ---------------------------------------------------------------- jerarquía de roles

-- Un tercer rol, `developer`, para la cuenta de quien construye el sistema.
-- Solo él edita o revoca administradores: un admin no puede actuar contra sí
-- mismo ni contra otros admins. La regla se aplica en la Edge Function
-- `staff-admin`; acá solo se abre el valor.
alter table public.staff_profiles drop constraint if exists staff_profiles_role_check;
alter table public.staff_profiles
  add constraint staff_profiles_role_check check (role in ('developer', 'admin', 'mesero'));

comment on column public.staff_profiles.role is
  'developer gestiona administradores; admin gestiona meseros y empleados; mesero opera la puerta.';

-- `is_admin()` es la llave de escritura de todo el esquema y `panel-base.js`
-- exige el mismo rol para dejar entrar. Si `developer` no contara como admin
-- acá, esa cuenta quedaría sin acceso a nada. La jerarquía entre los dos se
-- decide con `is_developer()`, no aflojando esta.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() in ('admin', 'developer'), false);
$$;

create or replace function public.is_developer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() = 'developer', false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_staff_role() in ('developer', 'admin', 'mesero'), false);
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_developer() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------- jornada

-- Cuántas horas tiene una jornada. Sin esta constante, "R$ 80 por día" no se
-- puede pasar a valor hora sin adivinar, y adivinar sobre el sueldo de alguien
-- no es una opción.
alter table public.site_settings
  add column if not exists horas_jornada integer not null default 8
    check (horas_jornada between 1 and 24);

comment on column public.site_settings.horas_jornada is
  'Horas de una jornada completa. Convierte entre sueldo por día y valor hora.';

-- `site_settings` se creó con `grant select` sobre la tabla entera para anon,
-- que era inocuo cuando solo guardaba enlaces a redes. Ahora suma un parámetro
-- de nómina, así que se cierra por columna: el visitante sigue viendo lo que
-- consume `publicidad.js` y nada más.
revoke select on public.site_settings from anon, authenticated;

grant select (id, instagram_url, tiktok_url, whatsapp_url, updated_at)
  on public.site_settings to anon;
grant select (id, instagram_url, tiktok_url, whatsapp_url, horas_jornada, updated_at)
  on public.site_settings to authenticated;

-- ---------------------------------------------------------------- catálogos

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.areas is
  'Dónde trabaja la persona: Cocina, Limpieza, Salón. Se dan de baja con `activa`, nunca se borran: hay legajos que las referencian.';

create table if not exists public.credenciales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activa boolean not null default true,
  da_acceso_panel boolean not null default false,
  rol_sugerido text check (rol_sugerido in ('admin', 'mesero')),
  created_at timestamptz not null default now()
);

comment on column public.credenciales.da_acceso_panel is
  'Si el puesto suele necesitar entrar al panel. No crea nada solo.';
comment on column public.credenciales.rol_sugerido is
  'Qué rol proponer cuando alguien pulsa "Dar acceso al panel", para no tener que
   recordar que un mesonero va como mesero. Es una sugerencia: quien decide es
   quien pulsa, y la Edge Function vuelve a verificar la jerarquía.';

alter table public.areas enable row level security;
alter table public.credenciales enable row level security;

-- Revocar antes de otorgar. Supabase le da permisos por defecto a `anon` sobre
-- las tablas nuevas del esquema público, y un `grant` de columnas se suma a ese
-- permiso en vez de reemplazarlo. Ya pasó con `seats.held_by`.
revoke all on public.areas from anon, authenticated;
revoke all on public.credenciales from anon, authenticated;

-- Estos dos sí son catálogos sin dato personal: el panel los lee directo.
grant select on public.areas to authenticated;
grant select on public.credenciales to authenticated;

drop policy if exists "admin ve las areas" on public.areas;
create policy "admin ve las areas"
  on public.areas for select to authenticated
  using (public.is_admin());

drop policy if exists "admin ve las credenciales" on public.credenciales;
create policy "admin ve las credenciales"
  on public.credenciales for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- legajos

create table if not exists public.empleados (
  id uuid primary key default gen_random_uuid(),

  -- El uuid sirve para la máquina pero no para que dos personas hablen por
  -- teléfono del mismo empleado. Mismo patrón que `orders.order_number`.
  codigo_num bigint generated by default as identity,
  codigo text generated always as ('EMP-' || lpad(codigo_num::text, 3, '0')) stored,

  nombre text not null,
  apellido text not null,
  documento text unique,
  fecha_nacimiento date,
  fecha_ingreso date not null default current_date,
  telefono text,
  email text,
  direccion text,

  area_id uuid references public.areas (id) on delete restrict,
  credencial_id uuid references public.credenciales (id) on delete restrict,

  dias_libres text[] not null default '{}',

  salario_cents bigint not null default 0 check (salario_cents >= 0),
  salario_unidad text not null default 'dia'
    check (salario_unidad in ('hora', 'dia', 'semana', 'mes')),
  bono_pct numeric(5,2) check (bono_pct is null or (bono_pct >= 0 and bono_pct <= 100)),

  estado text not null default 'activo' check (estado in ('activo', 'retirado')),
  fecha_retiro date,
  motivo_retiro text,

  staff_id uuid unique references public.staff_profiles (id) on delete set null,
  codigo_reloj text unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint empleados_dias_de_la_semana check (
    dias_libres <@ array['lunes','martes','miercoles','jueves','viernes','sabado','domingo']::text[]
  ),
  -- Un retiro sin fecha deja el legajo diciendo que la persona se fue pero sin
  -- cuándo, que es justo el dato que hace falta para reconstruir un pago.
  constraint empleados_retiro_con_fecha check (
    estado = 'activo' or fecha_retiro is not null
  )
);

comment on table public.empleados is
  'El legajo. Un empleado nunca se borra: pasa a `retirado`. Borrarlo perdería el
   historial de quién trabajó y cuánto se le pagó, que es justamente lo que hay
   que poder auditar.';
comment on column public.empleados.codigo is
  'Correlativo legible, EMP-001. Lo arma la base, no la aplicación.';
comment on column public.empleados.documento is
  'Cédula. Queda vacía mientras no se conozca; el formulario del panel la exige.';
comment on column public.empleados.staff_id is
  'Solo lo tienen quienes además entran al panel. Un legajo sin cuenta es lo normal.';
comment on column public.empleados.codigo_reloj is
  'El número que el captahuellas le asigna a esta persona. Los lectores biométricos
   no exportan la cédula: exportan un identificador propio, y sin esta columna no
   habría forma de saber a quién corresponde cada marcación.';
comment on column public.empleados.salario_cents is
  'Centavos, entero. Nunca punto flotante: 0.1 + 0.2 no da 0.3 ni en SQL ni en
   JavaScript, y una nómina que redondea mal cada línea termina pagando de menos
   a alguien todos los meses.';
comment on column public.empleados.bono_pct is
  'Bono porcentual fijo sobre el sueldo, si lo tiene. null = sin bono.';

create unique index if not exists empleados_codigo_unico on public.empleados (codigo_num);
create index if not exists empleados_activos on public.empleados (apellido, nombre) where estado = 'activo';

alter table public.empleados enable row level security;

-- Sin grants. La tabla trae cédula, dirección, teléfono y sueldo: el único
-- camino es la Edge Function `empleados` con service_role, que ya verificó que
-- quien llama sea admin. Un mesero autenticado tampoco la alcanza.
revoke all on public.empleados from anon, authenticated;

-- ---------------------------------------------------------------- marcaciones

-- El hueco del captahuellas. Todavía no se eligió el equipo, así que no se puede
-- escribir el lector de un archivo que nadie vio. Lo que sí se puede es dejar el
-- hueco con la forma correcta.
create table if not exists public.marcaciones (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid references public.empleados (id) on delete restrict,
  codigo_reloj text,
  momento timestamptz not null,
  tipo text not null check (tipo in ('entrada', 'salida')),
  origen text not null default 'captahuellas' check (origen in ('captahuellas', 'manual')),
  cargado_por uuid references auth.users (id) on delete set null,
  referencia_externa text not null,
  bruto text not null,
  created_at timestamptz not null default now()
);

comment on column public.marcaciones.bruto is
  'La línea tal como vino del aparato. Es la decisión que más importa de esta
   tabla: cuando aparezca el equipo real, la primera interpretación de sus
   columnas casi seguro va a estar mal en algo -el orden de día y mes, la zona
   horaria, qué marca es entrada y cuál salida-. Si solo se guardara el resultado
   interpretado, arreglarlo obligaría a volver a exportar del aparato, suponiendo
   que todavía tenga esos datos. Con la línea original se vuelve a procesar sin
   pedirle nada a nadie.';
comment on column public.marcaciones.empleado_id is
  'Puede quedar vacío: una marcación cuyo código de reloj no coincide con nadie
   igual se guarda, para no perder el dato mientras se corrige el legajo.';
comment on column public.marcaciones.referencia_externa is
  'El id que trae el aparato. Si el archivo no trae ninguno, la Edge Function usa
   el SHA-256 de `bruto`, así reimportar el mismo archivo nunca duplica.';

create unique index if not exists marcaciones_sin_duplicados
  on public.marcaciones (referencia_externa);
create index if not exists marcaciones_por_empleado
  on public.marcaciones (empleado_id, momento desc);

alter table public.marcaciones enable row level security;

revoke all on public.marcaciones from anon, authenticated;

-- ---------------------------------------------------------------- nómina

create table if not exists public.nomina_semanas (
  id uuid primary key default gen_random_uuid(),
  desde date not null,
  hasta date not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  cerrada_por uuid references auth.users (id) on delete set null,
  cerrada_en timestamptz,
  created_at timestamptz not null default now(),
  constraint nomina_semanas_rango_valido check (hasta >= desde)
);

create unique index if not exists nomina_semanas_sin_solapar
  on public.nomina_semanas (desde, hasta);

create table if not exists public.nomina_lineas (
  id uuid primary key default gen_random_uuid(),
  semana_id uuid not null references public.nomina_semanas (id) on delete cascade,
  empleado_id uuid references public.empleados (id) on delete set null,

  -- Copiados al cierre, no leídos del legajo.
  empleado_codigo text,
  empleado_nombre text,
  empleado_documento text,

  salario_base_cents bigint not null default 0 check (salario_base_cents >= 0),
  bono_pct numeric(5,2),
  bono_cents bigint not null default 0 check (bono_cents >= 0),
  descuento_cents bigint not null default 0 check (descuento_cents >= 0),
  total_cents bigint not null default 0,

  horas_trabajadas numeric(6,2),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nomina_lineas is
  'Una línea por empleado y semana. Guarda su propia copia de los números: si la
   línea leyera el sueldo actual del legajo, subirle el sueldo a alguien en
   octubre cambiaría lo que dice que se le pagó en marzo, y nadie podría
   reconstruir un pago viejo. Es el mismo criterio que ya usa la entrada emitida,
   que guarda su sección y su mesa aunque después cambie el salón.';
comment on column public.nomina_lineas.horas_trabajadas is
  'Reservado para cuando se sepa el formato del captahuellas. Hoy nadie lo llena:
   sin el formato real, cualquier fórmula sería una suposición sobre el dinero de
   otras personas.';

create unique index if not exists nomina_lineas_una_por_empleado
  on public.nomina_lineas (semana_id, empleado_id);

create table if not exists public.nomina_ajustes (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null references public.nomina_lineas (id) on delete cascade,
  tipo text not null check (tipo in ('sueldo', 'bono', 'descuento')),
  valor_cents bigint,
  porcentaje numeric(5,2),
  motivo text not null,
  hecho_por uuid references auth.users (id) on delete set null,
  hecho_en timestamptz not null default now(),
  constraint nomina_ajustes_con_motivo check (length(btrim(motivo)) >= 5),
  -- Un ajuste que no dice cuánto no dice nada.
  constraint nomina_ajustes_con_valor check (valor_cents is not null or porcentaje is not null)
);

comment on table public.nomina_ajustes is
  'Cada cambio de sueldo, bono o descuento, con motivo y autor. No se editan ni se
   borran: si algo salió mal se agrega otro que lo corrige, y quedan los dos. Un
   registro de pagos que se puede reescribir no sirve como registro.';

create index if not exists nomina_ajustes_por_linea
  on public.nomina_ajustes (linea_id, hecho_en desc);

-- No alcanza con no dar permisos: `service_role` los ignora, y la Edge Function
-- corre justamente con esa clave. El trigger es lo que hace la regla verdadera.
create or replace function public.nomina_ajustes_inmutables()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los ajustes de nómina no se editan ni se borran: agrega otro que lo corrija.';
end;
$$;

drop trigger if exists nomina_ajustes_sin_retoques on public.nomina_ajustes;
create trigger nomina_ajustes_sin_retoques
  before update or delete on public.nomina_ajustes
  for each row execute function public.nomina_ajustes_inmutables();

alter table public.nomina_semanas enable row level security;
alter table public.nomina_lineas enable row level security;
alter table public.nomina_ajustes enable row level security;

-- Igual que los legajos: son sueldos. Solo service_role, tras verificar el rol.
revoke all on public.nomina_semanas from anon, authenticated;
revoke all on public.nomina_lineas from anon, authenticated;
revoke all on public.nomina_ajustes from anon, authenticated;

-- Lo cobrado por mesas no alimenta la nómina: son circuitos separados. Ninguna
-- de estas tablas referencia `orders`, `tickets` ni `seats`, y conviene que
-- quede escrito para que nadie los enlace más adelante "para completar el
-- cuadro". Cruzarlos volvería la nómina dependiente de una noche floja de
-- ventas, que no es lo que se le prometió a nadie que trabaja.

-- ---------------------------------------------------------------- semilla

insert into public.areas (nombre) values
  ('Cocina'), ('Limpieza'), ('Salón')
on conflict (nombre) do nothing;

insert into public.credenciales (nombre, da_acceso_panel, rol_sugerido) values
  ('Mesonero',  true,  'mesero'),
  ('Gerente',   true,  'admin'),
  ('Portero',   false, null),
  ('Seguridad', false, null),
  ('Dueño',     true,  'admin')
on conflict (nombre) do nothing;

-- Enlaza los legajos de quienes ya tienen cuenta, y le arma el perfil a la
-- cuenta de desarrollo.
--
-- Nunca `raise exception`: si alguna cuenta todavía no existe en `auth.users`,
-- avisa y sigue. Una migración que falla por una cuenta que se crea a mano deja
-- el resto del esquema sin aplicar. Para volver a intentarlo cuando la cuenta
-- exista está `verificacion/enlazar-cuentas.sql`, que es este mismo bloque.
do $$
declare
  v_duenio uuid;
  v_uid uuid;
  v_persona record;
begin
  select id into v_duenio from public.credenciales where nombre = 'Dueño';

  -- La cuenta de desarrollo queda visible en la lista de usuarios, marcada como
  -- tal, aunque un admin no pueda tocarla. Una cuenta con poder total, oculta y
  -- permanente dentro del sistema de otra persona es una puerta trasera, aunque
  -- la intención sea buena. Al entregar el proyecto hay que eliminarla o
  -- transferirla; está anotado en la bóveda.
  select id into v_uid from auth.users where lower(email) = 'developer@enprokart.com';

  if v_uid is null then
    raise notice 'No existe developer@enprokart.com todavía. Créala en Authentication y corre verificacion/enlazar-cuentas.sql.';
  else
    insert into public.staff_profiles (id, email, role, display_name, must_change_password, admin_code)
    values (v_uid, 'developer@enprokart.com', 'developer', 'Desarrollo',
            true, (100 + floor(random() * 900))::int::text)
    on conflict (id) do update
      set role = 'developer',
          admin_code = coalesce(staff_profiles.admin_code,
                                (100 + floor(random() * 900))::int::text);
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

    -- El correo no tiene índice único (dos empleados pueden compartir el del
    -- local), así que la guarda es explícita: `on conflict do nothing` sin
    -- destino no detendría un segundo legajo idéntico.
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
