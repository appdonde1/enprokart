# Versiones

Qué trajo cada versión publicada. El detalle de cómo se hizo está en la
[[Bitácora]].

## 1.2.0 — 2026-09-12

Nombre puesto por el dueño. Primera versión publicada por SSH.

**Para el público**
- Portada panorámica en el celular: el evento de lado a lado, se desliza con el
  dedo, barras de progreso tipo historias, título y fecha sobre la foto.
- Compra en el teléfono: el plano del salón se ve completo y el botón «Cerrar»
  vuelve a estar en pantalla.
- La navegación de arriba ya no se corta en el celular.
- Las animaciones de entrada ya no parpadean al cargar.
- Menú con fotos, íconos de la app nuevos.
- Tocar el evento en «Próximos eventos» abre la compra aunque la portada muestre
  otra fecha.
- «Mis entradas» vuelve a funcionar, y abrir el QR de una entrada con la cámara
  del teléfono muestra esa entrada.
- Ajuste publicado el mismo día: la portada ya no lleva la foto de karts de
  fondo, que hacía ver el banner pegado encima de otra imagen. El banner se funde
  con la página.
- Ajuste publicado el mismo día: **la web en el teléfono se usa como una app.**
  Barra inferior con Inicio, Menú, Comprar (al centro), Reservar y Mis entradas;
  arriba queda solo la marca. Botones y textos más chicos, menú en dos columnas,
  experiencias en una fila que se desliza. «Mis entradas» empieza arriba y lleva
  la misma barra.

**Para el personal**
- Panel → Salón: VIP Plata completa en su propia fila, botones − y + dentro de
  cada mesa, y en el celular la hoja se arrastra entera.
- Panel → Portada: se recomienda imagen horizontal 16:9.
- Validación en la puerta arreglada: la función no arrancaba (503) y el escáner
  no leía el QR del correo.

**Por dentro**
- Deploy por SSH con `./desplegar.sh` y vuelta atrás con `--revertir`.
- Retirado el webhook público de deploy; SSH solo con llave; los 404 de
  imágenes ya no quedan en la caché de Cloudflare.
- Contraseña del correo y token del bot fuera del código, en secretos de
  Supabase (`asaas-webhook` v9, `courtesy-ticket` v15, `reporte-semanal` v3).
- `verify-ticket` v15.
- Migración `20260818000001` (A y B en 4×3) registrada.

**Avisos enviados por el bot:** versión 1.2.0; aclaración de que no hace falta
borrar la app; validación de entradas lista para el 26/09.

## Antes de la 1.2.0 (sin número)

Reconstruido de los commits de git.

| Fecha | Qué se hizo |
|---|---|
| 2026-08-11 | Paso del sitio estático a Supabase: esquema, RLS, reserva de sillas, panel de personal. Cobro con Pagar.me, reemplazado el mismo día por Mercado Pago (PIX en la página) y precios editables. |
| 2026-08-12 | Webhook de Mercado Pago verificado. Salón según el plano y venta por mesa. Portada editorial conectada a la base. Publicidad, empleos, redes y contador de visitas. Personal, legajos y nómina. Liberar la mesa al vencer el QR. Una entrada por invitado y auditoría de quién validó. |
| 2026-08-13 | Plano en papel y editor del salón con borrador. Portada en carrusel. Precios por persona. Validación con cámara en el panel. **Cobro migrado a Asaas.** Plata elegible en el plano (15 columnas). Mercado Pago retirado. **Sitio publicado en el VPS.** |
| 2026-08-14 | Deploy por webhook HTTPS, correo con las entradas por Hostinger, avisos por Telegram, consulta por cédula/CPF, retención de 90 días. Sin commit. |
| 14/08 al 12/09 | Cambios sin commitear y publicados a medias: Salón nuevo del panel, estilos del panel, carrusel, menú con fotos, reporte semanal. En ese período `verify-ticket` quedó desplegada con un error que la dejó sin arrancar. |
