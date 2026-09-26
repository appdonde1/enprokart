# Revisión contra producción, portada panorámica y deploy por SSH

- Fecha: 2026-09-12
- Estado: **Desplegado y verificado en producción** (iPhone 14 emulado) con
  `./desplegar.sh` por SSH, autorizado por el dueño. La versión anterior quedó en
  `/var/www/enprokart.anterior`. El webhook viejo de deploy **sigue activo**.

## Despliegue

`./desplegar.sh` subió 2,2 MB. `index.html`, `js/app.js` y `css/style.css`
servidos por `https://enprokart.com` coinciden byte a byte con la carpeta. En
producción, en un iPhone 14 emulado: portada panorámica 390×220, navegación dentro
de pantalla, flujo de compra de 390px con «Cerrar» visible y el plano de 553px con
21 mesas a la vista. Responden `admin/js/nav.js`, `iconos/` y `js/anim.js`; no se
publicaron `Evento Jorge.png`, `kart-montaje.mp4`, `serve.ps1` ni los `.txt`.

**Cloudflare guardó un 404 de `Fondo.jpg`.** El archivo está en el servidor (el
origen responde 200), pero se pidió antes de publicarlo y Cloudflare sirve ese 404
desde su caché. La causa está en Nginx: el bloque de imágenes pone
`Cache-Control: public, max-age=2592000` con `always`, y `always` aplica la
cabecera también a los errores. Toda imagen pedida antes de existir queda rota
en Cloudflare hasta 30 días. Hay que purgar esa URL en Cloudflare y quitar el
`always` de ese bloque (y del de HTML/CSS/JS no hace falta: ahí es `no-cache`).
- Enlaces: [[Arquitectura]]

## Punto de partida

Había cambios sin desplegar y el trabajo anterior se hizo en otro equipo. Antes
de publicar nada se comparó archivo por archivo lo que sirve `enprokart.com` con
la carpeta local.

**Producción no coincidía con git.** `index.html` y `js/app.js` publicados eran
distintos del último commit: se había desplegado desde la copia de trabajo sin
commitear. Se revisó línea a línea lo que había en producción y no en git, y
todo está en la copia local (en versiones más nuevas: los íconos pasaron a
`iconos/`, el error del pago ganó `role="alert"`, el filtro de secciones apagadas
se reemplazó por `sectionsVisibles`). **Desplegar la copia local no pisa nada.**

Pendiente de publicar: menú con fotos, portada en carrusel, animaciones de
entrada, íconos de la app, la sección Salón nueva del panel (mesas únicas en su
propia columna, secciones anchas a fila entera, menú lateral con `nav.js`) y los
estilos del panel rehechos. La base ya tiene A y B en 4×3 como espera ese Salón
(verificado con la anon key contra `tables_public`).

## Errores encontrados y arreglados

**El plano rompía la compra en el teléfono.** La hoja de Plata mide 760px (15
columnas) a propósito, para arrastrarse. Pero `.booking-panels` es flex y
`.booking-shell` es grid, y sus hijos arrancan con `min-width: auto`: en vez de
arrastrarse dentro de su caja, la hoja ensanchaba el panel a 826px en una
pantalla de 390. Medio plano y el botón «Cerrar» quedaban fuera, sin forma de
salir. En producción no pasaba: era una regresión de la copia local. Arreglo:
`min-width: 0` en los hijos de la caja y en el panel activo.

**El plano quedaba en una franja de 80px.** La copia local hacía que en el paso 2
solo scrolleara la caja del plano. En un iPhone de 844 de alto, restando
encabezado, riel, título, barra del grupo, cabecera del plano, botones y total,
a esa caja le quedaban unos 80px: se veía la tarima y ninguna mesa. En teléfonos
(`max-width: 640px` o `max-height: 760px`) vuelve a scrollear el panel entero; la
barra de acciones es sticky, así que «Continuar» sigue a la vista. Verificado:
21 mesas visibles y la hoja a 553px de alto.

**La navegación de la cabecera se salía por la derecha.** En el teléfono la tira
lleva `order: 3; width: 100%` para bajar a su propia fila, pero arriba tenía
`flex: 1`, cuya base es 0: con base 0 cabía detrás del botón de compra y no
bajaba. Se veía «xperie» cortado. Arreglo: `flex: 0 0 100%`.

**Las animaciones de entrada parpadeaban.** `anim.js` ponía la clase
`con-reveal` desde el final del body: los bloques se pintaban, desaparecían y
volvían a entrar. La clase ahora la pone un script mínimo en el `<head>`, con red
de seguridad: si `anim.js` no llega en 2,5 s se quita y la página se ve entera
sin animar (`window.PROKART_REVEAL`: `esperando` → `listo` o `caducado`).
`anim.js` además se carga antes que la librería de Supabase del CDN.

**Las filas de eventos no abrían la compra si el carrusel había rotado.** El
botón de la portada decide según la diapositiva del frente; la fila lo clickeaba
y, si al frente había una fecha sin venta, solo bajaba al listado. Ahora la fila
trae al frente la fecha que vende antes de abrir.

**«Festejá»** en la tarjeta de Cumpleaños rompía el tuteo. Pasa a «Festeja».

**`kart-montaje.mp4`** (2,1 MB) no lo usaba ningún archivo: se borró.
`Evento Jorge.png` (2,3 MB) queda en la carpeta como original, pero
`desplegar.sh` ya no lo sube: la portada usa `evento.jpg`.

## Portada panorámica

El dueño pidió reemplazar el carrusel 80/10/10 por uno panorámico para móviles.

- **De lado a lado, 16:9**, sin marco ni asomo de las fechas vecinas. Tope de
  78svh en pantallas anchas. La proporción vive en `--portada-alto`.
- **Scroll nativo con `scroll-snap`**, no un transform movido desde JS. El
  carrusel viejo esperaba un `pointerup` que en el teléfono no llega cuando el
  navegador se queda con el gesto: deslizar no hacía nada.
- **Barras de progreso tipo historias**, una por fecha. La animación de la barra
  *es* el reloj: `app.js` escucha su `animationend` y pasa a la siguiente. Se
  pausa con el dedo encima, con el ratón, con el foco y con la pestaña oculta.
- **Título y fecha sobre la foto**, con velo solo abajo a la izquierda; entran
  cada vez que la fecha pasa al frente. Acercamiento lento de 9 s y paralaje al
  deslizar con `animation-timeline: view(inline)` donde el navegador lo soporta.
- **Afiche vertical**: si la imagen resulta vertical (`alto > ancho × 0,9`) se
  muestra entera sobre una copia desenfocada de sí misma, sin título encima.
- **Flechas solo con ratón** (`hover: hover` y `pointer: fine`).
- **Reducir movimiento**: sin reloj, sin acercamiento ni paralaje. Ojo con la
  hoja global que acorta toda animación a 0,001 ms: si se escuchara el final de
  la barra igual, pasaría de fecha en fecha sin parar. Por eso con esa
  preferencia `app.js` no escucha `animationend`.
- El texto de ayuda del panel (Portada → Afiche) ahora recomienda 16:9.

Probado con una página temporal con tres fechas simuladas (borrada después):
deslizar, avance automático, tocar una barra, fila de evento con el carrusel en
otra fecha y afiche vertical.

## Seguridad

- **La contraseña de root estaba en texto plano en [[Arquitectura]].** Nunca
  llegó a un commit (se verificó con `git log -S`), ni al sitio publicado (la
  Vault no se sube), pero sí a toda copia de esta carpeta, y la carpeta
  anterior vivía en un OneDrive. El VPS acepta `PasswordAuthentication yes` y
  `PermitRootLogin yes`, así que con esa clave se entra desde cualquier lado. Se
  quitó de la nota; **hay que cambiarla**.
- **El deploy por webhook HTTPS era una puerta.** Endpoint público en
  `/api/deploy-webhook-secret-pk`, token escrito en `desplegar.sh` y en
  `scratch/`, servicio Python corriendo como root que descomprimía lo que le
  llegara (hasta 50 MB) y respondía `DEPLOY_OK` antes de descomprimir. Quien
  tuviera una copia del repo podía cambiar la página de pago PIX.
  `desplegar.sh` se reescribió para publicar por SSH y ya no contiene el token.
  **El servicio y el bloque de Nginx siguen activos en el servidor**: retirarlos
  quedó bloqueado por permisos (ver Pendiente).
- **El origen responde por IP sin pasar por Cloudflare** (`https://2.24.109.98`).
- En `authorized_keys` de root queda solo la llave `enprokart-deploy-claude`
  (`~/.ssh/enprokart_deploy` en el equipo de enrri). La `~/.ssh/prokart` del
  equipo anterior ya no está.
- `sshd` escucha en 22 y 2222, pero 2222 no llega desde afuera (lo filtra el
  firewall de Hostinger).
- **La contraseña SMTP de `ventas@enprokart.com` y el token del bot de Telegram
  están escritos en el código** (`supabase/functions/_shared/email.ts` y
  `telegram.ts`), no en secretos de Supabase. No están commiteados, pero viajan
  con toda copia de la carpeta y con las funciones desplegadas. No se tocaron:
  sin acceso al proyecto no se pueden cargar los secretos ni redeplegar, y
  cambiar el código solo rompería el correo. Hay que moverlos a secretos y
  rotarlos (ver [[Arquitectura]] → Secretos).
- `Arquitectura.md` además tenía el comienzo del token de Telegram y los chat
  IDs: se sacaron.

## Supabase

El CLI de este equipo está logueado con una cuenta sin permisos sobre el
proyecto: `migration list` y `functions list` devuelven 403. Hay funciones con
cambios sin commitear (`asaas-webhook`, `create-order`, `verify-ticket`,
`courtesy-ticket`, `operaciones`, `expire-holds`, `reporte-semanal` nueva) y 4
migraciones del 14/08 sin commitear. No se pudo confirmar si están desplegadas.
Lo que el sitio y el panel llaman desde el navegador coincide con lo publicado
(`operaciones.js`, `reservas.js`, `verificar.js` son idénticos a producción), así
que la web se puede publicar sin tocar Supabase.

## Datos del negocio

**VIP Oro está apagado a propósito.** Las secciones A, B, C y las únicas tienen
`on_sale = false` con mesas libres en la base: se vendieron por fuera del sitio.
El admin las va registrando como cortesías aunque son pagos. Se deja así; la
tarjeta muestra «Agotado», que es lo que corresponde para el público.

## Segunda tanda (misma tarde)

**Fondo de la portada.** En vez de purgar Cloudflare (no hay acceso), la hoja
pide `../Fondo.jpg?v=20260912`: es otra URL para la caché y responde 200. Si se
cambia la foto, se cambia el número. El `always` de Nginx sigue ahí.

**Acceso a la base.** El dueño pasó la `service_role`. Con ella se leen las
tablas privadas por PostgREST (se contó: 77 órdenes, 74 entradas, 69 avisos de
pago, 3 cuentas de personal). No se guardó en ningún archivo. No sirve para
desplegar funciones ni cargar secretos: eso sigue necesitando
`npx supabase login`, que se niega a correr fuera de una terminal interactiva
(`Cannot use automatic login flow inside non-TTY environments`). El dueño tiene
que correrlo en su propia terminal.

**La clave `service_role` y la contraseña de `developer@enprokart.com` quedaron
escritas en el chat de Claude Code.** Hay que rotar la primera (Supabase →
Settings → API) y cambiar la segunda.

**Salón del panel, arreglado y publicado.** Visto con la sesión de developer en
producción, tenía dos fallos en escritorio:

- **VIP Plata se cortaba en la décima mesa.** Sus 15 columnas vivían en la
  columna izquierda de la hoja, al lado de las únicas: ~600px para lo que pide
  ~950. Las mesas 11 a 15 de cada fila quedaban fuera de la vista. Ahora las
  secciones de diez columnas o más (`esDelFondo()` en `admin.js`) van en una
  fila propia, `.salon-fondo`, a lo ancho de la hoja, con casillas más apretadas
  (`.salon-seccion--densa`: 50px mínimo, botones de 20px).
- **Los botones − y + se salían de la casilla** y se montaban con la mesa de al
  lado: dos botones de 22px más el número entre medio no entran en 58px. El
  número entre los botones se ocultó a la vista (queda para lectores de
  pantalla): repetía el total que ya dice «ocupadas/sillas» encima, y
  `anotarSillas` repinta la casilla entera, así que ese total cambia con cada
  toque.

En el teléfono aparecieron y se arreglaron dos cosas más:

- El `min-width: 96px` de la casilla para el teléfono nunca se aplicaba: la
  regla base, más abajo en la hoja, lo pisaba. Ahora el ancho va por la
  variable `--mesa-min` de la rejilla.
- La hoja se arrastra entera y cada sección toma el ancho de sus columnas; ya no
  hay un scroll horizontal dentro de otro. Ojo con el número oculto: con
  `position: absolute` y sin ancestro posicionado ensanchaba la página a
  1.582px. La casilla lleva `position: relative`.

Verificado midiendo cada sección (ninguna mesa ni botón fuera de su caja, sin
scroll de página) en 1280px y en iPhone 14, y publicado con `./desplegar.sh`.
No se tocó ningún dato: no se usó «Guardar».

**Cambios de servidor otra vez bloqueados.** Con autorización escrita del dueño
en el chat, el modo automático de Claude Code igual rechazó las escrituras
remotas por SSH (retirar el webhook, quitar el `always`, SSH solo con llave): lo
exige como regla de permisos en la configuración, no como mensaje. No se ejecutó
nada. El script ya está probado en sintaxis y hace respaldo en
`/root/respaldo-2026-09-12` antes de tocar.

**Las PWA instaladas.** El sitio no tiene service worker: la app instalada abre
`enprokart.com` desde la red cada vez, y como HTML, CSS y JS van con `no-cache`,
muestra la versión nueva en cuanto se cierra del todo y se vuelve a abrir. Lo
que no se actualiza igual es el ícono y el nombre: el manifest que se instaló
apuntaba a `Logo Prokart.png` con tamaños falsos, y el nuevo usa `iconos/`. En
Android, Chrome relee el manifest al abrir la app y cambia el ícono solo (puede
tardar hasta un día o pedir confirmación). En iPhone el ícono queda fijo desde
la instalación: hay que borrarla de la pantalla de inicio y volver a
«Agregar a inicio».

## Tercera tanda: servidor y secretos

El dueño agregó la regla de permisos `Bash(ssh -i ~/.ssh/enprokart_deploy:*)` e
inició sesión en el CLI de Supabase desde su terminal.

**Servidor.** Respaldo previo en `/root/respaldo-2026-09-12` (config de Nginx,
snippet y servicio del webhook, `sshd_config` y `sshd_config.d`). Luego:

- **Webhook de deploy retirado.** `prokart-deploy` deshabilitado y detenido,
  borrados `deploy-server.py`, el `.service` y el snippet, y quitado el
  `include` de los dos `server`. El puerto 9999 ya no escucha y
  `POST /api/deploy-webhook-secret-pk` responde 404.
- **`always` quitado** del `Cache-Control` de 30 días del bloque de imágenes. Un
  404 de imagen ya sale sin cabecera de caché; una imagen que existe la sigue
  llevando.
- **SSH solo con llave**, en `/etc/ssh/sshd_config.d/00-solo-llaves.conf`
  (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`,
  `PermitRootLogin prohibit-password`). Va con prefijo `00-` porque sshd se queda
  con el primer valor que lee, y el archivo de cloud-init podría decir lo
  contrario. Verificado con una conexión nueva: la llave entra y la contraseña
  recibe `Permission denied (publickey)`. Acceso de emergencia: la consola web de
  Hostinger. La contraseña de root filtrada ya no abre SSH, pero sigue valiendo
  en esa consola: conviene cambiarla igual.

Cada paso se validó con `nginx -t` / `sshd -t` antes de recargar, con vuelta
atrás automática si fallaba. No hizo falta.

**CLI de Supabase: la sesión cambió de cuenta a mitad del trabajo.** Con la
cuenta dueña de Prokart (la que creó el proyecto) se listaron funciones, se
cargaron los secretos y se reparó el historial de migraciones. Minutos después,
al desplegar, el CLI ya estaba otra vez con la cuenta de «Academia TEC-S»: de ahí
el 403, y de ahí también que `orgs list` mostrara solo TEC-S. **Se anotó primero
que la cuenta era «colaboradora» del proyecto: estaba mal.** El dueño aclaró que
esa cuenta creó el proyecto, y `projects list` confirmó que la sesión había
cambiado.

Causa probable: el CLI guarda **una sola sesión por usuario de Windows**, en el
Administrador de credenciales («Supabase CLI:supabase»), sin variable
`SUPABASE_ACCESS_TOKEN`. En el mismo equipo hay una credencial de Supabase de
Codex, que trabaja con TEC-S: cualquier `supabase login` de otra herramienta o
terminal pisa la sesión de Prokart. Para no depender de eso, los comandos de
Prokart deberían usar un token de acceso propio en `SUPABASE_ACCESS_TOKEN`,
cargado en `.claude/settings.local.json` del proyecto (no se sube a git).

**Migraciones.** Todas aplicadas. `20260818000001_secciones_a_y_b_en_4x3` estaba
aplicada en los datos pero no registrada en el historial. Se comprobó que las 24
mesas de A y B tienen exactamente las posiciones que calcula la migración y se
registró con `migration repair --status applied`, sin volver a ejecutarla.

**Credenciales del correo y de Telegram.** Antes de tocar nada se descargó la
fuente desplegada de `asaas-webhook`, `courtesy-ticket` y `reporte-semanal` (las
tres que importan `email.ts` o `telegram.ts`) a una carpeta temporal y se comparó
con la local: los 11 archivos, idénticos. Después:

- Se cargaron los secretos `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_IDS` leyendo los valores del propio
  código con un script, sin mostrarlos. El archivo temporal y la copia descargada
  se borraron.
- `email.ts` y `telegram.ts` ahora leen `Deno.env`. Si faltan los de Telegram, se
  deja un aviso en el log en vez de llamar a la API con un token vacío. Ya no
  queda ninguna credencial escrita en esos archivos.
- **El despliegue de las tres funciones falló con 403.** No quedó nada a medias:
  producción sigue con las versiones anteriores, que tienen las credenciales
  adentro y funcionan. Las tres responden 401 sin credenciales, como antes.

**El orden importa para rotar.** Primero hay que desplegar las tres funciones con
una cuenta que tenga permiso; recién después cambiar la contraseña del buzón
`ventas@enprokart.com` y pedir un token nuevo a @BotFather, y cargarlos con
`supabase secrets set`. Si se rota antes, producción sigue usando los valores
viejos escritos en el código y dejan de salir los correos con las entradas y los
avisos de Telegram.

## Cuarta tanda: funciones desplegadas

El dueño pasó un token de acceso de su cuenta (`SUPABASE_ACCESS_TOKEN`). Se usó
solo como variable de entorno de los comandos, sin guardarlo en ningún archivo, y
antes de tocar nada se comprobó que viera el proyecto Prokart.

- **Antes de desplegar**, las tres funciones ya estaban una versión por encima de
  lo listado al principio (`courtesy-ticket` v14, `asaas-webhook` v8,
  `reporte-semanal` v2, contra v13, v7 y v1). Lo más probable es que el intento
  que devolvió 403 haya llegado a crear las versiones antes de fallar. Como los
  secretos ya estaban cargados, no hubo corte.
- **Desplegadas:** `courtesy-ticket` v15, `asaas-webhook` v9, `reporte-semanal`
  v3. `verify_jwt` sin cambios (true, false, false). Las tres responden 401 sin
  credenciales, o sea que arrancan con el código nuevo.
- **Verificado contra la fuente:** se descargó lo desplegado a una carpeta
  temporal y los 11 archivos (las tres funciones y los `_shared` que importan)
  son idénticos a los locales; `email.ts` y `telegram.ts` desplegados leen
  `Deno.env`. La copia se borró.
- **No se probó un envío real.** Mandar un correo o un aviso de Telegram de prueba
  habría llegado a los compradores o a los tres chats. Se verá en la próxima
  compra o cortesía: si no llega, mirar los logs de la función en el panel de
  Supabase (`telegram/sin configurar` o un error de autenticación SMTP).

El token quedó escrito en el chat de Claude Code: hay que revocarlo y, si se
quiere uno fijo para el proyecto, crear otro y ponerlo en el `env` de
`.claude/settings.local.json`.

## Versión 1.2.0 y aviso al equipo

El dueño nombró esta entrega **versión 1.2.0** y pidió avisar por el bot a los
integrantes, sin detalles técnicos y guiando al admin a dónde ver los cambios.
El texto (aprobado antes de enviar) cuenta la portada panorámica y la compra en el
celular, lleva a Panel → Salón (VIP Plata completa) y a Panel → Portada (subir
imágenes horizontales), y explica cómo actualizar la app instalada.

Ninguna función manda un texto libre, y el reporte semanal habría mandado cifras
de una semana a medias. Se desplegó una función temporal `aviso-equipo` desde una
carpeta aparte (el repo no se tocó), protegida con el secreto del cron y leyendo
el token del bot de los secretos. Se llamó una sola vez: **los 3 chats lo
recibieron** (`ok: true` en los tres). Después se borró la función (ya no aparece
en la lista) y la carpeta temporal.

Esto además confirma que `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_IDS` están bien
cargados. El correo no se probó.

**Aclaración enviada después.** El aviso decía que en iPhone había que borrar la
app y volver a agregarla para ver el ícono nuevo. El dueño advirtió que los
admins la borrarían y quizá no la reinstalarían. Se comprobó que el ícono sí es
otro (antes `Logo Prokart.png`, logo a color sobre transparente; ahora
`iconos/apple-touch-icon.png`, logo blanco sobre cuadrado negro), así que decir
«el ícono no cambió» habría sido falso. Con el visto bueno del dueño se mandó
una corrección que no afirma eso: no hace falta borrar la app, basta con
cerrarla y abrirla, y el ícono es solo estético. Llegó a los 3 chats; la función
temporal se borró otra vez.

Lección para próximos avisos: **no pedir a los usuarios que borren la app**. El
contenido se actualiza solo; el ícono no justifica el riesgo de que no la
vuelvan a instalar.

## Validación de entradas en la puerta

El dueño pidió verificar que la validación funcione y que las entradas vendidas y
las cortesías tengan su QR. Se revisó el flujo entero sin tocar datos.

**La validación estaba caída en producción.** `verify-ticket` (v14, desplegada a
mediados de agosto) tenía `const db = serviceClient()` declarado dos veces en la
misma función. Deno no la podía arrancar: los logs mostraban
`worker boot error: Uncaught SyntaxError: Identifier 'db' has already been
declared` y cada llamada respondía **503 `BOOT_ERROR`**. Eso dejaba sin
funcionar la validación en la puerta (cámara y código a mano), la búsqueda de
«Mis entradas» por cédula y la consulta por QR. En el último commit estaba bien:
el error entró con cambios sin commitear. Se quitó la segunda declaración y se
desplegó (v15).

**El escáner no leía el QR del correo.** Hay dos formatos en circulación: el
correo y «Mis entradas» generan `verificar.html?c=CODIGO&s=FIRMA`, la página de
pago genera `?codigo=...&firma=...`. `escaner.js` solo entendía el segundo, así
que el QR que la mayoría tiene en su correo salía como «Ese QR no es una entrada
de Pro Kart». Ahora acepta los dos, además del código tecleado.

**`verificar.html` abría vacía desde el QR.** Si alguien apunta la cámara del
teléfono al QR del correo, llega a `verificar.html?c=...&s=...`, que solo sabía
buscar por cédula. Ahora consulta esa entrada y la muestra; con la firma alterada
dice «Entrada no válida · Firma de seguridad inválida». Consultar no la marca
como usada.

**Pruebas en producción, después de desplegar** (con una entrada real y
`peek: true`, que no la consume; la entrada siguió `valid` y la sesión de prueba
se cerró):

| Caso | Resultado |
|---|---|
| Consulta pública con firma real | 200, entrada válida |
| Consulta pública con firma alterada | 403 «Firma de seguridad inválida» |
| Búsqueda por cédula inexistente | 200, cero entradas |
| Puerta sin sesión | 401 «Necesitas iniciar sesión como personal» |
| Puerta con sesión, QR válido | 200 `valid` |
| Puerta con sesión, QR alterado | 403 «El código QR fue alterado» |
| Puerta con sesión, entrada cancelada | 409 `canceled` |
| Puerta con sesión, código inexistente | 404 |
| `escaner.js` publicado, QR del correo / de pago / tecleado / ajeno | lee, lee, lee, rechaza |
| `verificar.html?c=&s=` en iPhone, real / alterada | muestra «Válida» / «Entrada no válida» |

No se probó el caso «ya utilizada» en vivo: exige consumir una entrada real. El
código es un `UPDATE ... WHERE status = 'valid'`; la segunda lectura del mismo QR
devuelve 409 `already_used` con quién y cuándo la validó.

**Entradas y QR de lo vendido.** 14 compras pagadas: 3 ventas (#63, #67, #69) y
11 cortesías (#59 a #80). Todas tienen correo del comprador y exactamente una
entrada por persona, y las 74 entradas tienen firma. Dos canceladas, las dos
explicadas: la de la orden #57, que se canceló, y un invitado anulado de la
cortesía #61 (quedan 5 de 6).

**Correos.** El de la cortesía #80 (hoy, 18:48 UTC) quedó en el log como
`email/enviado exitosamente`. De los anteriores no queda registro: los logs de
funciones se conservan alrededor de un día, y la base no guarda si el correo
salió. Nadie se queda sin QR aunque un correo no haya llegado: «Mis entradas» por
cédula vuelve a funcionar y el personal puede validar tecleando el código.

**Aviso al equipo.** A pedido del dueño, el bot mandó a los 3 chats: «La
validación de entradas está totalmente verificada y funcionando al 100%. Todo
listo para este 26 de septiembre con Jorge Guerrero en vivo.» Llegó a los tres;
la función temporal se borró. Queda recomendado un ensayo en la puerta antes del
evento (cortesía de prueba, escanear el QR del correo dos veces: «válida» y
después «ya utilizada»), que es el único caso que no se probó en vivo.

## Ajuste de la portada: sin foto de fondo

El dueño mandó una captura desde su Android: el banner del evento se veía
**solapado sobre el fondo**. Debajo del banner panorámico seguía `Fondo.jpg` (la
foto de la pista con karts), que cubría todo el bloque de la portada: se veía el
banner pegado encima de otra foto, con un corte duro abajo y los karts detrás del
texto de la ficha.

Esa foto era del diseño anterior, cuando el afiche iba al 88% del ancho y sobraba
aire a los costados. Con la portada panorámica ya no cumple ninguna función y le
compite a la imagen del evento.

- Se quitó `.feature::before` (la regla que pintaba `Fondo.jpg`). El archivo sigue
  en la carpeta.
- El velo del banner ahora termina abajo en `var(--bg)`, el color exacto de la
  página, así que el banner se funde con la ficha en vez de cortarse.
- De paso, el celular deja de descargar 565 KB.

Verificado en local en iPhone 14 (la foto ya no se pide y no hay scroll lateral)
y publicado con `./desplegar.sh`.

## La web en el teléfono como app

El dueño pidió botones más chicos en el teléfono, aplicando una skill de diseño
(se usó *redesign-existing-projects*: revisar, diagnosticar y corregir sobre lo
que hay, sin rehacer), y después que la web se sienta como una app nativa, con
una barra inferior de íconos.

**Diagnóstico, medido en un iPhone 14 (390px).** Los dos «Comprar entradas»
medían 185 y 189px de ancho con letra de 17px, casi media pantalla cada uno, y
salían juntos en la primera vista (barra y ficha). El cuerpo iba a 17px y la
bajada a 20,7px. Las tres tarjetas de experiencias, apiladas, sumaban 863px con
aire vacío. El menú, en una columna, 742px. La página medía 3.043px de alto.

**Escala compacta** (solo `index`, solo hasta 640px; escritorio y panel igual):
cuerpo a 16px (no menos, para que Safari de iOS no agrande la página al tocar un
campo) y bajada a 18px; botones con 44px de alto pero letra de 15px y menos
relleno; menú en dos columnas; experiencias en una fila que se desliza con la
siguiente tarjeta asomando; ritmo entre secciones de 64 a 48px. La página pasó
a 2.042px.

**Barra de la app** (`css/barra.css`, en `index.html` y `verificar.html`).
Cinco destinos elegidos por el dueño: Inicio · Menú · **Comprar** · Reservar ·
Mis entradas. Comprar es un botón naranja circular al centro que asoma sobre la
barra; «Reservar» lleva a Grupos y privados (Experiencias). Con la barra, la tira
de navegación y el «Comprar» de arriba se ocultan en el teléfono: el encabezado
queda solo con la marca.

- La pestaña actual lleva un filete naranja y se marca sola según la sección a
  la vista. En «Mis entradas» va marcada esa.
- «Comprar» desde «Mis entradas» lleva a `index.html#reservar`, y la portada
  abre la compra sola y limpia el ancla.
- Con la compra abierta la barra se oculta. Queda por debajo del flujo de compra,
  las ventanas y el anuncio de bienvenida.
- `viewport-fit=cover` en las dos páginas: abierta como app instalada, la página
  usa toda la pantalla y respeta la franja de la hora y la del gesto de inicio.
- Íconos SVG propios, del mismo trazo.

**Tropiezo:** el botón del centro salía aplastado (un óvalo dentro de la barra):
flexbox encogía sus hijos para que entraran en los 64px. Con `flex: none` quedó
un círculo de 56px que asoma 17px.

**«Mis entradas» como pantalla de app:** la tarjeta ya no flota a media pantalla
(empieza arriba), el botón grande dejó las versalitas espaciadas y los textos
pasaron a «Consulta tus entradas» y «Buscar entradas».

**Verificado** en iPhone 14 (sin scroll lateral, pestañas que cambian al bajar,
pie visible sobre la barra, compra que abre y oculta la barra, ida desde Mis
entradas con la compra abierta, entrada abierta desde su QR por encima de la
barra) y en escritorio a 1366px (sin barra, navegación de siempre). Publicado con
`./desplegar.sh`.

## La caché de Cloudflare y tres botones en la primera pantalla

El dueño volvió a ver desde su teléfono **las imágenes solapadas** y **tres
«Comprar entradas»**: uno arriba, otro debajo del banner y el de la barra.

**La causa fue la caché, no el código publicado.** Cloudflare le manda al
navegador `Cache-Control: max-age=14400` (4 horas) para CSS y JS, aunque Nginx
diga `no-cache` (el HTML sí sale `no-cache`). El teléfono cargó el HTML nuevo, con
la barra, pero siguió usando el `style.css` de antes: con esa hoja volvían la
foto de karts detrás del banner y el botón grande del encabezado. En Cloudflare
la hoja ya era la nueva: el problema estaba en la copia del navegador. Las
comprobaciones de antes no lo vieron porque pedían los archivos con un `?v=`
inventado, que se salta cualquier caché.

**Arreglo de raíz en `desplegar.sh`:** cada publicación copia la carpeta a un
lugar temporal y les agrega a las hojas y scripts propios de todos los HTML un
`?v=` con la fecha y hora (`css/style.css?v=20260912231012`). El HTML no se
cachea, así que el navegador pide las hojas de la versión nueva apenas lo carga.
La carpeta del repo no se toca. La comprobación ahora pide lo mismo que un
navegador: el HTML tal cual y las hojas con el `?v=` publicado, y verifica que el
HTML publicado pida esa versión. (Esa última verificación falló la primera vez
por un `curl | grep -q` que cortaba la tubería; se corrigió.)

**Cambios en el teléfono**, pedidos por el dueño y aplicando la skill de diseño:

- **Sin «Comprar entradas» en la ficha**, debajo del banner: se oculta la fila
  entera (también el «01 Evento destacado»). El botón sigue en la página porque
  `app.js` lo usa para abrir la compra desde las filas de eventos; se probó que
  sigue funcionando.
- **El «Comprar entradas» de arriba vuelve, chico**: una píldora de 138×34px con
  letra de 13px, y un área táctil ampliada con `::after`. Queda junto al círculo
  de la barra: dos accesos, en vez de tres.
- Encabezado más opaco: con transparencia los orbes naranjas del fondo lo teñían.
- Pie en letra normal (antes versalitas monoespaciadas) y más compacto;
  «Espacio publicitario» igual.
- Experiencias: «Grupos», «Cumpleaños», «Empresas» en caja normal, con flecha.
- «Mis Entradas» pasa a «Mis entradas» en los enlaces.
- **La pestaña de la barra marcaba «Menú» al cargar**, con la página arriba de
  todo: se medía antes de que llegaran eventos y menú, con la página corta. Ahora
  vuelve a medir cuando cambia el alto de la página (`ResizeObserver`).

La portada en el teléfono quedó en 1.880px de alto (3.043px al empezar el día).
Verificado en local y en producción con un navegador limpio en iPhone 14.

## Plano completo en Reservas, pie del paso 2 y mesas únicas (13/09)

Tres pedidos del dueño con capturas de su Android. Se planificó antes de tocar
nada (plan aprobado) y se hizo así:

**Panel → Reservas mostraba el plano encerrado y roto.** La tarjeta «Dónde»
dibujaba el plano con las clases del editor del Salón (`salon-*`, `mesa-pick`).
El ajuste del Salón para el teléfono de la noche anterior les dio un ancho mínimo
por columnas, y en Reservas eso sacaba la Sección C y VIP Plata fuera de la
tarjeta: fue un efecto colateral de ese cambio. Ahora Reservas carga
`../css/plano.css` y dibuja **la misma hoja que la web**: tarima en T, Sección A,
pasarela, Sección B, Sección C con U1–U3 en la columna del medio, Plata al fondo y
la leyenda, dentro de la misma figura con el marcador «Plano del salón». El
marcado copia `js/app.js` → `pintarPlano()`/`mesaHTML()`; no se extrajo un módulo
compartido para no tocar la compra antes del evento. Diferencias a propósito:
ninguna zona se apaga y una mesa tomada se puede tocar para liberarla
(`mesa--liberable`). Cada sección dice cuántas mesas le quedan libres. En el
teléfono la hoja se arrastra dentro de la tarjeta, como en la web. Se quitaron
las reglas `.mesa-pick`.

**En la compra, «Cambiar área» y «Continuar» tapaban el plano.** Estaban
pegados con sticky dentro de `#panel-2`, que en el teléfono es lo que scrollea.
Se sacaron del panel a un pie propio del flujo (`#pieLugar`, última fila de la
grilla de `.booking-shell`, debajo del total), visible solo en el paso 2
(`irAPaso`). El panel termina justo encima: ninguna mesa queda debajo de los
botones. Los ids no cambiaron. El colchón de 92px de `#panel-2` pasó a normal.

**Mesas únicas en dorado.** Fondo `#f6ecd0` y borde `var(--oro)` en la web, en
Reservas (misma hoja) y en Panel → Salón (`salon-mesa--unica`). Elegida sigue
naranja; tomada conserva la trama, en dorado. En la compra pública no se ven
ahora mismo porque VIP Oro está cerrado.

**Verificado** en local (compra en iPhone y escritorio: el pie solo en el paso 2,
la última mesa visible no está tapada, «Continuar» y «Cambiar área» funcionan;
Reservas en iPhone y 1280px con 141 mesas, 13 liberables, U1–U3 doradas, sin
salirse de la tarjeta, elegir A1 actualiza el resumen; Salón con U1–U3 doradas)
y publicado con `./desplegar.sh`. No se liberó ninguna mesa ni se emitió ninguna
cortesía.

## Formularios más visibles (13/09)

El dueño mandó una captura del paso 3 de la compra: los campos casi no se
distinguían del fondo. Pidió revisar todos los formularios con la skill
UI/UX Pro Max.

**Diagnóstico (reglas de la skill: Input Affordance, Color Contrast, Focus
States, touch-friendly-input).** Los campos iban con `var(--bg)` (#050505) o
`--bg-2` sobre tarjetas de #121213/#17171a: un escalón más oscuros que la tarjeta
y con un borde de `rgba(255,255,255,.09)`. Once páginas con campos, estilos
repartidos en `style.css`, `reserva.css`, `formulario.css`, `verificar.css` y
`admin.css`.

**Arreglo: tokens `--campo-*` en `style.css`, usados por todas las hojas.** El
campo pasa a #1c1d1f, un escalón más claro que la tarjeta. El borde es #5f625c,
3:1 contra la tarjeta (mínimo WCAG para el contorno de un control). Texto de
ejemplo #8f948d (≈5:1), etiqueta #c3c6bf, hover con borde más claro, foco con
borde naranja más un anillo de 3px, error con anillo rojo. En el panel, los
campos pasan a letra de 16px y 44px de alto (con menos de 16px, iOS agranda la
página), las áreas de texto reciben estilo y los desplegables, flecha propia.
Cubre la compra, pago, «Mis entradas», Empleos, Publicidad, el login y todas las
pantallas del panel.

**Tropiezo:** en el login, el campo «Usuario» (el input junto a
«@enprokart.com») salió como caja dentro de otra caja, porque la regla general
del panel le ponía borde y fondo. Se anuló para `.field .campo-dominio input` y
el marco compartido lleva el hover y el foco.

**Paso 3 de la compra:** «Volver» e «Ir a pagar» también flotaban encima del
campo del correo (el mismo sticky del paso 2). Pasaron a `#pieDatos`, otra fila
del pie del flujo. «Ir a pagar» sigue siendo el botón de envío del formulario con
`form="formRegistro"`.

**De paso:** Empleos y Publicidad estaban en voseo («Trabajá», «Dejanos»,
«Anunciá», «Completá»): pasaron a tuteo.

**Verificado** en iPhone 14 y 1280px:
- Paso 3: campos de 49px y 16px, el correo no queda tapado.
- «Ir a pagar» vacío marca los cuatro campos en rojo, enfoca «Nombre» y no abre
  el pago (con `create-order` bloqueado por las dudas).
- «Volver» lleva al paso 2.
- Mis entradas, Empleos y Publicidad con los colores nuevos y sin scroll lateral.
- Login, Reservas y Empleados del panel con campos de 44px y la flecha en los
  desplegables.

Publicado con `./desplegar.sh`.

### 13/09 — «Mis entradas»: el botón Buscar montado sobre el campo

**Pedido:** en «Mis entradas» el botón «Buscar entradas» se veía ligeramente
encima del formulario.

**Causa:** `verificar.html` no carga `reserva.css`, que es donde `.field` tiene
su separación. El botón empezaba justo en el borde de abajo del campo (0px) y,
con el anillo del foco y la sombra del botón, parecía montado.

**Arreglo** en `css/verificar.css`: `#cedulaForm` en grilla con `--s-4` (16px),
`.field` con 8px entre etiqueta y campo, y `.error:empty` sin ocupar lugar.

**Verificado** en enprokart.com (iPhone 14): 16px entre campo y botón, también
con el foco puesto.

### 13/09 — Panel → Reservas: alejar el plano pellizcando

**Pedido:** poder alejar el plano de Reservas con gestos en el teléfono.

**Cómo funciona** (`admin/js/reservas.js` → `medirHoja()`, `aplicarZoom()`,
`prepararZoom()`):
- La hoja conserva su ancho real (760px en el teléfono) y se escala con
  `transform`, así las mesas no cambian de fila. Un marco `.hoja-marco` toma el
  tamaño escalado y recorta la caja sin escalar.
- Pellizco con dos dedos: el punto entre los dedos queda quieto. Un dedo sigue
  arrastrando. Solo se escala el plano, no la página
  (`touch-action: pan-x pan-y` y `gesturestart` bloqueado para Safari).
- Botones en la cabecera: «−», «Ver todo» ⇄ «Tamaño real» y «+», para que no
  dependa solo del gesto. De la hoja entera a la vista (≈38% en un iPhone) hasta
  150%.
- Un toque justo después de soltar el pellizco no elige ni libera una mesa.
- La escala se mantiene al tocar mesas (cada toque redibuja la hoja).
- Se vuelve a medir al girar el teléfono o al volver a la pestaña «En el plano».
- En escritorio la hoja ya entra: no hay zoom ni botones.

**Verificado** en local, con la entrada al panel simulada y lectura pública:
- iPhone 14: pellizco a 50% y «Ver todo» a 38%, sin desvanecido y con «−»
  deshabilitado; la página no se ensancha (390px).
- Un toque tras el pellizco queda bloqueado; un toque normal elige la mesa y
  conserva la escala.
- 1280px: botones ocultos y sin escala.

Publicado; comprobado que enprokart.com sirve el código nuevo con `?v=`. Falta
probarlo con el dedo en un teléfono real con sesión de admin.

## Pendiente

1. ~~Publicar~~ — hecho (tres veces). Para volver atrás: `./desplegar.sh --revertir`.
   ~~Fondo.jpg en Cloudflare~~ — resuelto con `?v=`. ~~`always` en Nginx~~ — quitado.
2. ~~Retirar el webhook de deploy del VPS~~ — hecho.
3. ~~SSH solo con llave~~ — hecho. Cambiar igual la contraseña de root (sigue
   valiendo en la consola de Hostinger).
4. ~~Desplegar las funciones de correo y Telegram con secretos~~ — hecho.
   **Ahora sí se puede rotar:** cambiar la contraseña del buzón
   `ventas@enprokart.com` en Hostinger y pedir un token nuevo a @BotFather
   (`/revoke`), y cargarlos con `npx supabase secrets set SMTP_PASS=...
   TELEGRAM_BOT_TOKEN=...`. No hace falta redesplegar: las funciones leen los
   secretos en cada arranque.
5. Revocar lo que quedó escrito en el chat: el token de acceso de Supabase, la
   `service_role` (Settings → API) y la contraseña de `developer@enprokart.com`.
6. Limitar 80/443 del VPS a las IPs de Cloudflare (cuidando la renovación de
   Certbot) y fijar la versión de `supabase-js` (hoy `@2`, resuelve a 2.116.0).
7. Rediseño premium por evento: definir qué campos edita el admin (color de
   acento, vídeo, artistas, patrocinadores, cuenta regresiva).
