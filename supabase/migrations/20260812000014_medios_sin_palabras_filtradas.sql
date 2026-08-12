-- Las piezas alquiladas se servían desde un bucket llamado `publicidad`, con
-- archivos que decían `banner`. Los bloqueadores de anuncios filtran por esas
-- palabras en la URL: el navegador cancelaba la descarga con
-- ERR_BLOCKED_BY_CLIENT y el espacio quedaba vacío.
--
-- Eso no es un detalle estético: quien paga por ese espacio no aparece para una
-- porción grande de los visitantes. Se sirve desde `medios`, que no dispara
-- ningún filtro. No hay nada que esconder —son piezas propias del sitio, no
-- rastreo de terceros—, simplemente se deja de usar un nombre que las herramientas
-- interpretan como publicidad de red.

insert into storage.buckets (id, name, public)
values ('medios', 'medios', true)
on conflict (id) do update set public = true;

drop policy if exists "medios visibles" on storage.objects;
create policy "medios visibles"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'medios');

drop policy if exists "admin sube medios" on storage.objects;
create policy "admin sube medios"
  on storage.objects for all to authenticated
  using (bucket_id = 'medios' and public.is_admin())
  with check (bucket_id = 'medios' and public.is_admin());
