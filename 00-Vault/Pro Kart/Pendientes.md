# Pendientes

Lista viva: se tacha lo hecho y se agrega lo nuevo. Última revisión: 2026-09-12.
Cómo hacer cada cosa: [[Operación]].

## Antes del evento (26 de septiembre)

- [ ] **Ensayo en la puerta.** Crear una cortesía de prueba a nombre propio,
  escanear con el panel (Validar → cámara) el QR que llega por correo: debe decir
  «Entrada válida». Escanearlo otra vez: debe decir «Entrada ya utilizada». Es el
  único caso de la validación que no se probó en vivo. Después, anular la
  cortesía de prueba.
- [ ] Probar el escáner en los teléfonos que se van a usar en la puerta, con la
  pantalla de un invitado real (brillo alto) y con conexión del salón.
- [ ] Decidir si se reenvía el correo con QR a las 13 compras anteriores al
  12/09: de esos envíos no queda registro. Hoy no hace falta para entrar: se
  puede buscar por cédula en «Mis entradas» o teclear el código en la puerta.

## Seguridad: credenciales que quedaron expuestas

Quedaron escritas en el chat de trabajo del 12/09 o en notas anteriores.

- [ ] **Revocar el token de acceso de Supabase** (`sbp_…`) en supabase.com →
  Account → Access Tokens. Si se quiere uno fijo para trabajar, crear otro y
  cargarlo en el `env` de `.claude/settings.local.json`.
- [ ] **Rotar la `service_role`** de Supabase (Settings → API). Antes, revisar
  qué la usa: las Edge Functions la reciben sola; el sitio usa la clave
  publicable, que no cambia.
- [ ] **Cambiar la contraseña de `developer@enprokart.com`.**
- [ ] **Cambiar la contraseña de root del VPS** desde la consola de Hostinger.
  Ya no abre SSH, pero sigue valiendo en esa consola.
- [ ] **Cambiar la contraseña del buzón `ventas@enprokart.com`** (Hostinger →
  Correos) y cargarla con `supabase secrets set SMTP_PASS=...`. No hace falta
  redesplegar.
- [ ] Token del bot de Telegram: el dueño considera que nadie más lo tiene y no se
  rota por ahora. Si aparecen mensajes del bot que nadie mandó: `/revoke` en
  @BotFather y `supabase secrets set TELEGRAM_BOT_TOKEN=...`.

## Mantenimiento

- [ ] **Hacer commit en git.** Hay unos 63 archivos sin commitear: el despliegue
  publica desde la carpeta, no desde git, y producción ya no coincide con el
  último commit. Si la carpeta se pierde, se pierde la versión 1.2.0.
- [ ] Limitar los puertos 80/443 del VPS a las IPs de Cloudflare: hoy el sitio
  responde también directo por la IP. Cuidar que Certbot pueda renovar.
- [ ] En Cloudflare → Caching → Configuration → **Browser Cache TTL**, elegir
  «Respect Existing Headers». Hoy impone 4 horas a CSS y JS por encima del
  `no-cache` de Nginx. El sello `?v=` de `desplegar.sh` ya lo resuelve para
  las páginas; esto lo arregla también para cualquier archivo que se enlace sin
  pasar por un HTML.
- [ ] Fijar la versión de `supabase-js` en las páginas (hoy `@2`, que resuelve a
  2.116.0 y puede cambiar sola).
- [ ] Unificar el formato de los QR (`?c=&s=` y `?codigo=&firma=`). No es urgente:
  el escáner acepta los dos, y tiene que seguir aceptándolos por las entradas ya
  enviadas.
- [ ] Guardar en la base si el correo con las entradas salió (hoy solo queda en
  los logs, que duran un día).
- [ ] Al entregar el proyecto: degradar y eliminar la cuenta `developer`
  (ver [[Arquitectura]] → La cuenta de desarrollo).

## Web en el teléfono (seguimiento de la barra de app)

- [ ] Probar en un iPhone y un Android reales, en el navegador y como app
  instalada: que la barra no tape nada y que la franja del gesto de inicio quede
  libre.
- [ ] Decidir si `empleos.html` y `anunciar.html` llevan la barra (hoy no).
  `pagar.html` no la lleva a propósito: es la pantalla del cobro.
- [ ] El pie de la portada repite «Mis entradas» y sigue en versalitas
  monoespaciadas; revisar si conviene simplificarlo ahora que la barra tiene los
  destinos principales.

## Próximo trabajo

- [ ] **Rediseño premium editable por evento.** Definir qué cambia el admin en
  cada evento: color de acento, vídeo, artistas, patrocinadores, cuenta regresiva.

## Hecho el 2026-09-12

- [x] Publicar la versión 1.2.0 y el arreglo del Salón del panel.
- [x] Deploy por SSH y retiro del webhook público de deploy.
- [x] SSH solo con llave; caché de 404 de imágenes corregida.
- [x] Credenciales de correo y Telegram fuera del código, en secretos.
- [x] Registrar la migración de A y B en 4×3.
- [x] Validación de entradas: `verify-ticket` arreglada, escáner con los dos
  formatos de QR, `verificar.html` abre la entrada desde su QR.
- [x] Avisos al equipo por el bot (versión 1.2.0, aclaración de la app,
  validación lista).
