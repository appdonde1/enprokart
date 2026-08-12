-- Abre el sitio a terceros: publicidad alquilable, postulaciones de empleo,
-- solicitudes de cambio de clave y un contador de visitas que no se pueda inflar.
--
-- Nada de esto toca la venta de entradas. Son tablas nuevas, con los mismos
-- criterios de siempre: RLS activa, grants explícitos y `is_admin()` como única
-- llave de escritura.

-- ---------------------------------------------------------------- redes y contacto

-- Fila única: `id boolean primary key check (id)` solo admite `true`, así no
-- hay forma de terminar con dos filas de ajustes y sin saber cuál manda.
create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  instagram_url text,
  tiktok_url text,
  whatsapp_url text,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (true) on conflict (id) do nothing;

alter table public.site_settings enable row level security;

revoke all on public.site_settings from anon, authenticated;

grant select on public.site_settings to anon, authenticated;
grant insert, update on public.site_settings to authenticated;

drop policy if exists "redes visibles" on public.site_settings;
create policy "redes visibles"
  on public.site_settings for select to anon, authenticated
  using (true);

drop policy if exists "admin edita las redes" on public.site_settings;
create policy "admin edita las redes"
  on public.site_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- publicidad

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  advertiser text,
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ad_campaigns_rango_valido check (ends_on >= starts_on)
);

comment on table public.ad_campaigns is
  'Campaña pagada. Vale mientras current_date esté dentro del rango y active sea true.';

create table if not exists public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('banner', 'overlay')),
  image_path text not null,
  link_url text,
  is_evergreen boolean not null default false,
  campaign_id uuid references public.ad_campaigns (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Una pieza es vitalicia o pertenece a una campaña; nunca las dos ni ninguna.
  constraint ad_creatives_vitalicia_o_campana check (
    (is_evergreen and campaign_id is null) or
    (not is_evergreen and campaign_id is not null)
  )
);

comment on column public.ad_creatives.image_path is
  'Ruta dentro del bucket `publicidad` de Storage, no una URL completa.';
comment on column public.ad_creatives.link_url is
  'A dónde lleva el anuncio. Si una vitalicia lo deja vacío, el sitio manda a anunciar.html.';

-- Una sola vitalicia por espacio: si hubiera dos, cuál se muestra sería azar.
create unique index if not exists ad_creatives_una_vitalicia_por_slot
  on public.ad_creatives (slot) where is_evergreen;

-- Y una sola pieza por espacio dentro de cada campaña.
create unique index if not exists ad_creatives_un_slot_por_campana
  on public.ad_creatives (campaign_id, slot) where campaign_id is not null;

alter table public.ad_campaigns enable row level security;
alter table public.ad_creatives enable row level security;

-- Revocar antes de otorgar. Supabase le da permisos por defecto a `anon` sobre
-- las tablas nuevas del esquema público, y un `grant` de columnas se suma a
-- ese permiso en vez de reemplazarlo: sin este revoke, el visitante anónimo
-- leería la tabla entera igual. Ya pasó con `seats.held_by`.
revoke all on public.ad_campaigns from anon, authenticated;
revoke all on public.ad_creatives from anon, authenticated;

grant select, insert, update, delete on public.ad_campaigns to authenticated;
grant select, insert, update, delete on public.ad_creatives to authenticated;

drop policy if exists "admin gestiona campanas" on public.ad_campaigns;
create policy "admin gestiona campanas"
  on public.ad_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin gestiona piezas" on public.ad_creatives;
create policy "admin gestiona piezas"
  on public.ad_creatives for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Qué se muestra hoy en cada espacio.
--
-- La regla de prioridad vive acá y no en el navegador: gana la pieza de una
-- campaña vigente y, si no hay ninguna, cae en la vitalicia. `distinct on`
-- devuelve una sola fila por espacio, y el `order by` decide cuál: como false
-- ordena antes que true, la pieza de campaña le gana a la vitalicia.
create or replace view public.ads_public
with (security_invoker = true) as
select distinct on (c.slot)
  c.slot,
  c.image_path,
  c.link_url,
  c.is_evergreen as es_vitalicia
from public.ad_creatives c
left join public.ad_campaigns k on k.id = c.campaign_id
where c.is_evergreen
   or (k.active and current_date between k.starts_on and k.ends_on)
order by c.slot, c.is_evergreen asc, k.starts_on desc;

grant select on public.ads_public to anon, authenticated;

-- La vista corre con los permisos de quien consulta, así que el visitante
-- anónimo necesita alcanzar las tablas de abajo. Se le abre lo mínimo: las
-- piezas que están al aire hoy, y de las campañas solo las fechas que definen
-- esa vigencia. Una campaña que arranca la semana que viene, con su anunciante
-- y su imagen, no tiene por qué ser visible desde afuera.
drop policy if exists "campanas vigentes visibles" on public.ad_campaigns;
create policy "campanas vigentes visibles"
  on public.ad_campaigns for select to anon, authenticated
  using (active and current_date between starts_on and ends_on);

-- El `exists` de abajo consulta ad_campaigns, y esa consulta también pasa por
-- RLS: para un visitante solo existen las campañas vigentes, así que una pieza
-- de campaña futura o vencida no es legible.
drop policy if exists "piezas al aire visibles" on public.ad_creatives;
create policy "piezas al aire visibles"
  on public.ad_creatives for select to anon, authenticated
  using (
    is_evergreen
    or exists (select 1 from public.ad_campaigns k where k.id = campaign_id)
  );

grant select (id, slot, image_path, link_url, is_evergreen, campaign_id)
  on public.ad_creatives to anon;
grant select (id, starts_on, ends_on, active)
  on public.ad_campaigns to anon;

-- ---------------------------------------------------------------- solicitudes

-- Las tres bandejas en una tabla: el panel las lista igual y filtra por `kind`.
-- Se escriben solo desde la Edge Function `crear-solicitud` con service_role;
-- por eso no hay grant de insert para anon.
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('empleo', 'publicidad', 'clave')),

  nombre text,
  apellido text,
  documento text,
  whatsapp text,
  email text,

  comercio text,        -- publicidad
  descripcion text,     -- publicidad
  cv_path text,         -- empleo: ruta en el bucket privado `curriculums`
  staff_email text,     -- clave: a quién hay que reiniciarle el acceso

  status text not null default 'nueva' check (status in ('nueva', 'atendida')),
  notes text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users (id)
);

create index if not exists requests_pendientes
  on public.requests (kind, created_at desc) where status = 'nueva';

comment on table public.requests is
  'Postulaciones de empleo, pedidos de publicidad y reinicios de clave. Trae cédulas: nunca legible por anon.';

alter table public.requests enable row level security;

-- Acá el revoke no es prolijidad: la tabla guarda cédulas y rutas de
-- currículums. Sin él, el permiso por defecto de Supabase la dejaría legible
-- para cualquier visitante con la anon key, que es pública.
revoke all on public.requests from anon, authenticated;

grant select, update on public.requests to authenticated;

drop policy if exists "admin ve solicitudes" on public.requests;
create policy "admin ve solicitudes"
  on public.requests for select to authenticated
  using (public.is_admin());

drop policy if exists "admin atiende solicitudes" on public.requests;
create policy "admin atiende solicitudes"
  on public.requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- visitas

-- La clave primaria compuesta ES la deduplicación: si la misma persona vuelve
-- a entrar el mismo día, el insert choca y no suma.
create table if not exists public.visits_daily (
  day date not null default current_date,
  visitor_hash text not null,
  first_seen timestamptz not null default now(),
  primary key (day, visitor_hash)
);

comment on column public.visits_daily.visitor_hash is
  'SHA-256 de sal-del-día + IP + user-agent. La sal rota cada día: no se puede revertir a una IP ni seguir a alguien entre días.';

create table if not exists public.visits_totals (
  day date primary key,
  pageviews bigint not null default 0,
  uniques integer not null default 0
);

comment on column public.visits_totals.pageviews is 'Cargas de página, incluidas las recargas.';
comment on column public.visits_totals.uniques is 'Visitantes distintos del día. Es el número honesto.';

alter table public.visits_daily enable row level security;
alter table public.visits_totals enable row level security;

-- `visits_daily` queda sin ningún permiso: guarda los hashes de visitante y
-- solo la toca la función de abajo, que corre como definer. El panel lee el
-- resumen; el visitante recibe su número por la Edge Function.
revoke all on public.visits_daily from anon, authenticated;
revoke all on public.visits_totals from anon, authenticated;

grant select on public.visits_totals to authenticated;

drop policy if exists "admin ve las visitas" on public.visits_totals;
create policy "admin ve las visitas"
  on public.visits_totals for select to authenticated
  using (public.is_admin());

-- Cuenta una visita y devuelve el estado del día en una sola operación.
--
-- `found` después de un `on conflict do nothing` es true solo si la fila entró
-- de verdad: eso distingue a un visitante nuevo de una recarga.
create or replace function public.registrar_visita(p_hash text)
returns table (visitas_hoy integer, vistas_hoy bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo boolean;
begin
  insert into public.visits_daily (day, visitor_hash)
  values (current_date, p_hash)
  on conflict do nothing;

  v_nuevo := found;

  insert into public.visits_totals (day, pageviews, uniques)
  values (current_date, 1, case when v_nuevo then 1 else 0 end)
  on conflict (day) do update
    set pageviews = public.visits_totals.pageviews + 1,
        uniques = public.visits_totals.uniques + case when v_nuevo then 1 else 0 end;

  return query
    select t.uniques, t.pageviews
    from public.visits_totals t
    where t.day = current_date;
end;
$$;

revoke all on function public.registrar_visita(text) from public, anon, authenticated;
grant execute on function public.registrar_visita(text) to service_role;

-- ---------------------------------------------------------------- storage

-- Dos buckets con permisos opuestos, a propósito:
--   `publicidad`  público, porque las piezas se muestran a cualquier visitante.
--   `curriculums` privado, porque un CV trae teléfono, dirección y a veces
--                 cédula. Se descarga con URL firmada de vida corta.
insert into storage.buckets (id, name, public)
values ('publicidad', 'publicidad', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('curriculums', 'curriculums', false)
on conflict (id) do update set public = false;

drop policy if exists "publicidad visible" on storage.objects;
create policy "publicidad visible"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'publicidad');

drop policy if exists "admin sube publicidad" on storage.objects;
create policy "admin sube publicidad"
  on storage.objects for all to authenticated
  using (bucket_id = 'publicidad' and public.is_admin())
  with check (bucket_id = 'publicidad' and public.is_admin());

-- Los currículums no llevan política de lectura para nadie: ni anon ni el
-- personal autenticado. Solo service_role, que no pasa por RLS, y firma la
-- descarga cuando el admin la pide.
