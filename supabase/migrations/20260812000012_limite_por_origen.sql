-- Los formularios de empleo y publicidad son públicos y sin captcha: cualquiera
-- puede mandar cien solicitudes y dejar la bandeja del panel inservible.
--
-- Se guarda un hash del origen (misma receta que el contador de visitas: sal
-- del día + IP, sin guardar la IP) para poder contar cuántas mandó ese origen
-- en la última hora y frenarlo. Es un hash y no la IP porque para limitar
-- alcanza con saber que "es el mismo de antes", no quién es.

alter table public.requests
  add column if not exists origin_hash text;

comment on column public.requests.origin_hash is
  'Hash del origen para limitar envíos por hora. Rota cada día: no identifica a nadie.';

create index if not exists requests_por_origen
  on public.requests (origin_hash, created_at desc);
