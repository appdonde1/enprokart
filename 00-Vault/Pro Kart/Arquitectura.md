# Arquitectura · Pro Kart Web

Nota viva: refleja cómo está armado el sistema hoy. Se edita, no se acumula.
La historia de cada trabajo va en [[Bitácora]].

Versión publicada: **1.2.0** (2026-09-12).

Ver también: [[Inicio]] · [[Operación]] (cómo hacer cada tarea) ·
[[Pendientes]] · [[Versiones]] · [[Bitácora]].

Última revisión: 2026-09-12 — ver
[[2026-09-12 - revisión contra producción, portada panorámica y deploy por ssh]].

## Panorama

```
01 - Entradas/            sitio estático, sin build ni bundler
  index.html              portada panorámica + compra en 4 pasos (área, lugar, datos, pago)
  pagar.html              QR de PIX y estado del cobro
  verificar.html          consulta pública de entradas y QR por Cédula / CPF
  empleos.html            postulaciones
  anunciar.html           solicitud de espacio publicitario
  admin/                  panel de personal (Salón, Portada, Reservas, Nómina…)
supabase/
  migrations/             esquema, RLS, funciones, retención 90 días
  functions/              Edge Functions en Deno
desplegar.sh              publica 01 - Entradas en el VPS por SSH
00-Vault/Pro Kart/        esta Vault
```

Proyecto Supabase: `tgilgfwxtghcqskfyzif`
Pasarela: Asaas (PIX por la API de Cobros)

## Infraestructura y hosting

| Capa | Proveedor | Detalle |
|---|---|---|
| **DNS + proxy** | Cloudflare (Free) | Proxy activo (nube naranja), encriptación **Full (strict)**, SPF/DKIM/DMARC |
| **Web (estáticos)** | VPS Hostinger | IP `2.24.109.98`, Ubuntu 24.04, Nginx 1.24, `/var/www/enprokart`, certificado Let's Encrypt (Certbot) |
| **Despliegue web** | SSH | `./desplegar.sh`: tar por SSH, intercambio de carpetas, `--revertir` |
| **Backend (funciones)** | Supabase Edge Functions | Deno |
| **Base de datos** | Supabase (Postgres) | RLS estricto, `cleanup_old_records_90_days()` con `pg_cron` |
| **Email transaccional** | Hostinger SMTP | `ventas@enprokart.com` (remitente `"ProKart"`), `smtp.hostinger.com:465` |
| **Notificaciones** | Telegram `@Prokart1_bot` | 3 chats reciben cada compra, cortesía y el reporte semanal |

### Publicar el sitio

```bash
./desplegar.sh              # desde la raíz del repo
./desplegar.sh --revertir   # vuelve a la versión anterior
```

Cómo funciona:

1. Empaqueta `01 - Entradas` sin `*.txt`, `serve.ps1`, `*.mp4` ni
   `Evento Jorge.png` (el original pesado; la portada usa `evento.jpg`).
2. Lo descomprime por SSH en `/var/www/enprokart.nuevo`, comprueba que haya
   `index.html`, ajusta dueño (`www-data`) y permisos.
3. Mueve la versión publicada a `/var/www/enprokart.anterior` y pone la nueva en
   su lugar. Nginx no necesita recargarse.
4. Compara el MD5 de `index.html`, `js/app.js` y `css/style.css` servidos por
   `https://enprokart.com` con los locales.

Variables opcionales: `PROKART_SSH` (por defecto `root@2.24.109.98`) y
`PROKART_LLAVE` (por defecto `~/.ssh/enprokart_deploy`).

Deploy de funciones: `npx supabase functions deploy <nombre>`.

El webhook de deploy anterior (`prokart-deploy`) se retiró del servidor el
2026-09-12. Ver «Lo que se eliminó».

### Acceso al VPS

| Dato | Valor |
|---|---|
| Host | `2.24.109.98`, usuario `root` |
| Llave | `~/.ssh/enprokart_deploy` (ed25519, comentario `enprokart-deploy-claude`). Es la única en `authorized_keys`. |
| Puertos | `sshd` escucha en 22 y 2222; desde afuera solo llega el 22 |
| `sshd` | **Solo llave**: `/etc/ssh/sshd_config.d/00-solo-llaves.conf` con `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password` |
| Emergencia | Consola web de Hostinger (hPanel), que no pasa por SSH |
| Respaldo | `/root/respaldo-2026-09-12`: configuración de Nginx y de SSH previa al cambio |

El archivo lleva prefijo `00-` a propósito: sshd se queda con el **primer** valor
que lee de cada opción, y el archivo de cloud-init de `sshd_config.d` puede traer
`PasswordAuthentication yes`.

**La contraseña de root no se escribe en esta nota ni en ningún archivo.** Estuvo
escrita acá hasta el 2026-09-12. Ya no abre SSH, pero sigue valiendo en la
consola de Hostinger: hay que cambiarla.

Nginx: `/etc/nginx/sites-enabled/enprokart`. Las cabeceras de seguridad viven en
`snippets/prokart-seguridad.conf` y se incluyen en cada `location`, porque
`add_header` no se hereda. `/admin/`, `verificar.html` y `pagar.html` van con
`noindex` y `no-store`; imágenes con 30 días de caché; HTML, CSS y JS con
`no-cache`.

> **Imágenes y Cloudflare.** Hasta el 2026-09-12 el `Cache-Control` de 30 días del
> bloque de imágenes llevaba `always`, que lo aplicaba también a los 404: una
> imagen pedida antes de publicarse quedaba rota en Cloudflare aunque después se
> subiera (pasó con `Fondo.jpg`, que por eso se pide como
> `Fondo.jpg?v=20260912`). Se quitó el `always`; los 404 ya no se cachean. Si
> vuelve a pasar con una URL vieja: purgarla en Cloudflare o cambiar el `?v=`.

### La app instalada (PWA)

Hay `manifest.json` con íconos en `iconos/`, pero **no hay service worker**. La
app instalada en el teléfono es una ventana sin barra que abre
`https://enprokart.com` desde la red: no guarda nada offline, así que cada
despliegue le llega al cerrar la app del todo y volver a abrirla. El ícono y el
nombre son otra cosa: Android los relee del manifest con el tiempo; iPhone los
congela al instalar y hay que reinstalar para verlos cambiados.

Si algún día se agrega un service worker, esto deja de ser gratis: tiene que
tener estrategia de actualización (`skipWaiting` + aviso de «hay una versión
nueva»), o las apps instaladas se quedan con la versión vieja.

Respaldo del sitio: `/var/www/enprokart.anterior` (lo deja cada deploy).

### Consultar la base de datos

El CLI de Supabase se usa con `npx supabase`. El login solo funciona en una
terminal interactiva (en un shell automático falla con `non-TTY`), y el proyecto
ya está enlazado (`supabase/.temp/project-ref`).

```bash
npx supabase login                                        # en la terminal propia; abre el navegador
npx supabase link --project-ref tgilgfwxtghcqskfyzif      # init no hace falta: config.toml ya existe
npx supabase projects list                                # debe mostrar Prokart, ACTIVE_HEALTHY
```

**Cuidado con la sesión compartida.** El CLI guarda una sola sesión por usuario
de Windows (Administrador de credenciales, «Supabase CLI:supabase»). En el equipo
de enrri también se usa Supabase para «Academia TEC-S», y un `supabase login` de
esa otra cuenta —desde otra terminal o desde Codex— reemplaza la de Prokart sin
avisar: el 2026-09-12 la sesión cambió a mitad del trabajo y el despliegue de
funciones devolvió 403. Antes de desplegar, `npx supabase projects list` tiene
que mostrar **Prokart**. Lo robusto es un token de acceso de la cuenta dueña en
`SUPABASE_ACCESS_TOKEN`, cargado en el `env` de `.claude/settings.local.json`
(ignorado por git), que tiene prioridad sobre la sesión guardada.

La anon key del navegador **no sirve** para mirar datos privados: `orders`,
`tickets` y `webhook_events` le están revocadas a `anon` desde
`20260811000006_fix_seat_column_grants.sql`. Devuelve `42501 permission denied`.
Sí sirve para lo público (`events`, `sections`, `tables_public`, `menu_items`,
`ads_public`). Para lo privado hace falta la `service_role`, que se saca del CLI:

```bash
npx supabase projects api-keys --project-ref tgilgfwxtghcqskfyzif -o json
```

y con ella se consulta PostgREST en `https://tgilgfwxtghcqskfyzif.supabase.co/rest/v1/`,
mandándola en `apikey` y en `Authorization: Bearer`. La `service_role` saltea RLS
entera: se usa para leer, nunca se escribe con ella sin pensarlo dos veces, y no
se copia a ningún archivo del repo — se pide al CLI cada vez.

Lo que más se consulta cuando hay una duda de plata:

| Pregunta | Consulta |
|---|---|
| Estado de una compra | `orders?order_number=eq.63&select=*` |
| Qué dijo Asaas de verdad | `webhook_events?external_event_id=like.*<pay_id>*&select=payload` |
| Si salieron las entradas | `tickets?order_id=eq.<uuid>&select=code,status,table_code` |

`webhook_events.payload` guarda el aviso de Asaas entero y es la mejor prueba
que hay: trae `status`, `netValue`, `creditDate` y `refunds` del pago. Ojo, esa
tabla no tiene `created_at`; el momento es `processed_at`.

## El salón

Estado de la base a 2026-09-12 (evento `noche-vip-fest`):

| Sección | Mesas | Sillas | Grilla (`pos_x × pos_y`) | Precio por persona | Área en la compra |
|---|---|---|---|---|---|
| `A` | 12 | 6 | 4 × 3 | R$ 400 | VIP Oro |
| `B` | 12 | 6 | 4 × 3 | R$ 400 | VIP Oro |
| `C` | 24 | 6 | 9 × 3, con la columna del medio libre | R$ 400 | VIP Oro |
| `UNICA1..3` | 1 cada una (U1–U3) | 8 | columna del medio de C | R$ 400 | VIP Oro |
| `PLATA` | 66 (P1–P66) | 4 | 11 × 6 | R$ 300 | VIP Plata |
| `GENERAL` | — | de pie | — | R$ 200 | General |

- **Se vende la mesa entera** al precio por persona × sillas; una entrada por
  persona. Un grupo de 7 en Oro necesita 2 mesas.
- **Oro y Plata se eligen en el plano.** Plata dejó de ser «orden de llegada»:
  todas tienen `assignment_mode = manual`. `General` es `none`.
- Las únicas van en secciones propias para poder tener precio propio, pero se
  dibujan dentro de C.
- **VIP Oro está apagado a propósito** (`on_sale = false` en A, B, C y las
  únicas, con mesas libres): se vendió por fuera del sitio y el admin lo va
  registrando como cortesías aunque son pagos. La tarjeta muestra «Agotado».

`sections.assignment_mode` (`manual` / `auto_fcfs` / `none`) es lo que decide el
comportamiento. Lo que sí está atado a nombres en `app.js`: la tarjeta «VIP Oro»
agrupa las secciones `manual` que no son `PLATA`, el plano agrupa mesas por la
letra del código (A, B, C, P) y la cantidad de sillas por mesa del cálculo de
grupo es 6 en Oro y 4 en Plata.

## La portada

Carrusel panorámico, una diapositiva por evento publicado de hoy en adelante.

- 16:9 de lado a lado (`--portada-alto`), scroll nativo con `scroll-snap`.
- Barras de progreso tipo historias; la animación de la barra es el reloj
  (6,5 s, `carrusel.PAUSA` en `app.js`).
- Sobre la foto, solo `name` y la fecha sin hora. Debajo, la ficha de la fecha
  del frente: `description`, fecha larga, `venue`/`city` y el botón, que dice
  «Comprar entradas» solo si la fecha es `is_main` y `sells_tickets`.
- Imagen: `events.cover_image`, ruta relativa al sitio (`evento.jpg`) o URL.
  Se recomienda panorámica 16:9. Si es vertical se muestra entera sobre un fondo
  desenfocado, sin título encima. Sin imagen o si falla: `placeholders/evento-generico.jpg`.
- Con «reducir movimiento» no hay reloj, ni acercamiento, ni paralaje.
- **Sin foto de fondo.** Debajo del banner va el color de la página, y el velo
  del banner termina en ese mismo color (`var(--bg)`). `Fondo.jpg` (la pista con
  karts) se quitó el 2026-09-12: detrás de un banner de lado a lado hacía ver una
  imagen pegada sobre otra. No volver a poner una imagen detrás de la portada.

## La web en el teléfono

En el teléfono (hasta 640px) la web se comporta como una app. En escritorio no
cambia nada de esto.

**La barra de la app** vive en `css/barra.css` y la llevan `index.html` y
`verificar.html` (las dos con la clase `con-barra` en `<html>`). Destinos, en
este orden: Inicio · Menú · **Comprar** · Reservar · Mis entradas.

- «Comprar» es el único relleno naranja de la barra, circular y al centro. Es un
  enlace a `#reservar`, así que lo recoge el mismo código que abre la compra desde
  cualquier otro botón. Desde otra página va a `index.html#reservar`, y la
  portada abre la compra al cargar.
- «Reservar» lleva a Experiencias (grupos, cumpleaños, empresas), no a la compra.
- La pestaña actual se marca con `aria-current` según la sección a la vista
  (script en `index.html`). En otras páginas va fija en el HTML.
- Con la barra, la tira de navegación de arriba se oculta: los destinos no se
  repiten arriba y abajo.
- **Botones de compra en el teléfono: dos, no tres.** Arriba, un «Comprar
  entradas» chico (píldora de 34px, letra de 13px, área táctil ampliada), y el
  círculo de la barra. El de la ficha, debajo del banner, se oculta junto con su
  fila; **no se borra del HTML** porque `app.js` lo usa para abrir la compra desde
  las filas de eventos.

**Caché del navegador.** Cloudflare impone a CSS y JS `max-age=14400` (4 horas)
aunque Nginx diga `no-cache`. Por eso `desplegar.sh` sella las hojas y scripts
propios con `?v=<fecha y hora>` en los HTML publicados: sin eso, un teléfono
combina el HTML nuevo con la hoja vieja. Si se agrega una hoja o un script, basta
con enlazarlo con ruta relativa (`css/…`, `js/…`, `../css/…`) para que reciba el
sello.
- Capas: la barra en `--z-sticky`; el flujo de compra, las ventanas y el anuncio
  de bienvenida le pasan por encima. Con la compra abierta se oculta.
- Las páginas llevan `viewport-fit=cover` y la barra respeta
  `env(safe-area-inset-bottom)`, el encabezado `env(safe-area-inset-top)`.
- Los hijos de cada pestaña llevan `flex: none`: sin eso el botón del centro se
  aplasta dentro de los 64px de la barra.

**Escala de la portada en el teléfono** (bloque 16 de `style.css`, con `.home`):
cuerpo a 16px —no menos: con menos, Safari de iOS agranda la página al tocar un
campo—, bajada a 18px, botones de 44px de alto con letra de 15px, menú en dos
columnas y experiencias en una fila deslizable.

Para agregar la barra a otra página: `class="con-barra"` en `<html>`, enlazar
`css/barra.css`, `viewport-fit=cover` y copiar el `<nav class="app-barra">` de
`verificar.html` marcando su pestaña con `aria-current="page"`.

## Decisiones que no se ven en el código

**El precio nunca llega desde el navegador.** `create-order` lo lee de
`sections.price_cents` en cada venta. Si el cliente manda un precio, se ignora:
probado mandando R$ 1 con el precio real en R$ 199,99, y se cobró el de la base.
Lo edita el admin desde el panel (pestaña Salón); RLS rechaza a cualquier otro
rol, y un trigger deja registrado el cambio en `price_updated_at`.

**El comprador no sale del sitio para pagar.** `create-order` crea la cobranza
PIX en Asaas y `pagar.html` muestra el QR y el copia-e-cola. La mesa queda
tomada mientras vive el QR; `expire-holds` la libera y cancela la cobranza
vencida.

**El webhook de Asaas no confía en lo que le llega.** Asaas solo avisa «algo
cambió»: el sistema consulta su API para saber el estado real del pago, así que
una notificación falsificada no puede emitir entradas. Además exige
`ASAAS_WEBHOOK_TOKEN`. URL registrada en Asaas:
`https://tgilgfwxtghcqskfyzif.supabase.co/functions/v1/asaas-webhook`, con los
eventos `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`,
`PAYMENT_DELETED` y `PAYMENT_REFUNDED`.

**`seats.held_by` no se expone.** Guarda el id de la orden, que es el token con
el que el comprador consulta su propio pago. Si el mapa público lo mostrara,
cualquiera podría leer órdenes ajenas y quedarse con códigos de entrada válidos.
Por eso el `GRANT` sobre `seats` es por columna: `anon` solo ve
`id, table_id, number, status`. Realtime respeta ese límite.

**Emitir entradas y marcar pagos no tiene policy de escritura para ningún rol.**
Solo ocurre dentro de Edge Functions con `service_role`. Ni siquiera un admin
puede marcar una orden como pagada desde el panel.

**Consultar una entrada no es validarla.** `verify-ticket` hace tres cosas
distintas. Sin sesión, `consultar_ticket` (código y firma del QR) y
`consultar_por_cedula` solo leen: son las que usa `verificar.html` para que el
comprador vea sus entradas. Con sesión de personal y sin `action`, valida en la
puerta: comprueba la firma y marca la entrada como `used` con quién y cuándo, en
un único `UPDATE ... WHERE status = 'valid'`, así que dos validaciones
simultáneas no consumen la misma entrada. Con `peek: true` responde lo mismo sin
marcarla, y es como se prueba en producción sin gastar entradas reales. Una
persona que abre el QR con la cámara del teléfono ve «Válida», pero eso no deja
pasar a nadie: en la puerta se usa el escáner del panel.

**Hay dos formatos de QR en circulación, y el escáner acepta los dos.** El
correo (`_shared/email.ts`) y «Mis entradas» (`verificar.js`) generan
`verificar.html?c=CODIGO&s=FIRMA`; la página de pago (`pagar.js`) genera
`?codigo=...&firma=...`. Hasta el 2026-09-12 `escaner.js` solo leía el segundo, y
el QR que llega por correo salía como «no es una entrada de Pro Kart». Si se
unifica el formato, el escáner tiene que seguir aceptando los dos: hay entradas
ya enviadas con cada uno.

**Una función que no arranca no avisa sola.** El 2026-09-12 se encontró
`verify-ticket` desplegada con `const db` declarado dos veces: `SyntaxError` al
arrancar y 503 `BOOT_ERROR` en cada llamada, o sea puerta, «Mis entradas» y
consulta por QR caídas desde su despliegue de mediados de agosto, sin que nada lo
notara. Después de desplegar una función hay que llamarla una vez; los errores
de arranque se ven en los logs como `worker boot error`.

**Los meseros leen `tickets_staff`, no `tickets`.** RLS filtra filas, no
columnas, así que la vista es lo que les oculta documento y WhatsApp.

**El legajo de un empleado no es una cuenta de acceso.** `empleados` y
`staff_profiles` son tablas distintas, unidas por `empleados.staff_id`, que casi
siempre es nulo. Alguien de cocina o limpieza tiene ficha y sueldo y nunca entra
al panel; un mesonero tiene las dos cosas. Mezclarlas crearía decenas de cuentas
que nadie usa, y cada cuenta viva es una puerta más en un sistema que mueve
dinero. El botón «Dar acceso al panel» es lo único que enlaza una con otra.

**Las tablas de personal no tienen ningún `GRANT`.** `empleados`, `marcaciones`,
`nomina_semanas`, `nomina_lineas` y `nomina_ajustes` guardan cédula, dirección,
teléfono y sueldo. Ni `anon` ni `authenticated` las alcanzan: el único camino son
las Edge Functions `empleados` y `nomina`, que verifican el rol antes de devolver
una fila. Es lo mismo que se hizo con `orders` y `tickets` en
`20260812000009_quitar_security_definer.sql`. `areas` y `credenciales` sí se leen
directo, porque son catálogos sin dato personal.

**Cada semana de nómina guarda su propia copia de los números.** Si la línea
leyera el sueldo actual del legajo, subirle el sueldo a alguien en octubre
cambiaría lo que dice que se le pagó en marzo. Al cerrar la semana se copian
nombre, cédula y código a la línea, y ahí quedan. Es el mismo criterio que la
entrada emitida, que guarda su sección y su mesa aunque después cambie el salón.

**Los ajustes de nómina no se editan ni se borran.** Además de no tener permisos,
`nomina_ajustes` lleva un trigger `before update or delete` que lanza excepción,
porque `service_role` ignora los permisos y la Edge Function corre con esa clave.
Si algo salió mal se agrega otro ajuste que lo corrige, y quedan los dos. Un
registro de pagos que se puede reescribir no sirve como registro.

Consecuencia que costó descubrir: **una fila inmutable no puede tener llaves
foráneas que la actualicen.** `nomina_ajustes.hecho_por` apuntaba a `auth.users`
con `on delete set null`, y ese SET NULL es un UPDATE que el trigger rechaza, así
que una cuenta que hubiera tocado un sueldo no se podía eliminar. El ajuste ahora
copia el nombre de su autor al hacerse y `hecho_por` es un uuid suelto, sin
llave. Cualquier columna que se agregue a esa tabla apuntando a otra tiene que
seguir el mismo criterio.

**El idioma del sitio es español latino, con tuteo.** «Elige tu mesa», no «Elegí
tu mesa»; «puedes», no «podés»; «festeja», no «festejá». Vale para los textos de
pantalla y para los mensajes de error de las Edge Functions, que llegan al
comprador tal cual.

**El editor del salón no guarda solo.** Los precios y las sillas se acumulan en
un borrador y salen en una sola tanda, con la cuenta de lo pendiente a la vista y
aviso al salir. Antes cada clic escribía en la base, y un clic de más ya era un
cambio hecho sobre lo que se cobra.

**El plano del comprador es una hoja clara sobre una página oscura.** Es el único
momento de la compra en que se mira el salón, y se ve distinto a propósito. Las
sillas no se dibujan: se vende la mesa entera, así que su cantidad es un dato y
no una forma que haya que contar. La posición sale de `pos_x`/`pos_y`, lo mismo
que edita el panel, así que agregar una fila no obliga a tocar el dibujo.

**Panel → Reservas dibuja la misma hoja que la web.** `admin/reservas.html`
carga `../css/plano.css` y `admin/js/reservas.js` copia el marcado de
`js/app.js` → `pintarPlano()`/`mesaHTML()`: el admin elige mesas viendo el salón
igual que el comprador. Si cambia una, se cambia la otra. En el panel ninguna
zona se apaga y las tomadas se pueden tocar para liberarlas (`mesa--liberable`).
No reutilizar las clases del editor del Salón (`salon-*`) para esto: son de otra
pantalla y un ajuste allá rompió Reservas el 2026-09-12.

**Zoom del plano de Reservas (solo el panel).** `pintarPlano()` envuelve la hoja
en `.hoja-marco`. `aplicarZoom()` fija la hoja a su ancho real, la escala con
`transform` y le da al marco el tamaño escalado. Se aleja pellizcando con dos
dedos o con los botones de `#planoZoom` (−, Ver todo/Tamaño real, +), entre la
hoja entera y 150%. Solo aparece cuando la hoja no entra en el lienzo (teléfono).
La compra en la web no tiene zoom.

**Los botones de los pasos 2 y 3 no van dentro del panel.** «Cambiar área» y
«Continuar» viven en `#pieLugar`, y «Volver» e «Ir a pagar» en `#pieDatos`: las
dos son filas del pie de la grilla de `.booking-shell` y `irAPaso()` muestra la
del paso actual. Dentro del panel —que en el teléfono scrollea— los botones
nacían encima del plano o del campo del correo. «Ir a pagar» queda fuera del
`<form>` pero es su botón de envío por `form="formRegistro"`.

**Los campos de formulario usan los tokens `--campo-*` de `style.css`.** Fondo
un escalón más claro que la tarjeta, borde a 3:1, texto de ejemplo legible,
anillo naranja en el foco y rojo en el error. Todas las hojas con campos
(`reserva.css`, `formulario.css`, `verificar.css`, `admin.css`) los usan: para
cambiar cómo se ven los campos en todo el sitio, se tocan ahí. En el panel los
campos van con letra de 16px y 44px de alto para que iOS no agrande la página al
tocarlos. Revisado con la skill UI/UX Pro Max el 2026-09-13.

**Las mesas únicas (U1–U3) van en dorado claro** con borde dorado, en la web, en
Reservas y en el Salón: el admin las ubica de un vistazo.

**En el teléfono el plano se arrastra, no se encoge.** La hoja mide al menos
760px (Plata son 15 columnas) para que cada mesa siga siendo tocable. Eso obliga
a dos cosas en el CSS del flujo: `min-width: 0` en los hijos de
`.booking-shell` y en el panel activo —si no, la hoja ensancha la pantalla y el
botón «Cerrar» queda afuera— y, en pantallas chicas, que scrollee el panel
entero y no solo la caja del plano, que si no queda en 80px.

**Las animaciones de entrada no pueden esconder contenido.** La clase
`con-reveal` la pone un script en el `<head>` antes de la primera pintura; si
`anim.js` no llega en 2,5 s se quita y todo queda visible. Con «reducir
movimiento» no se aplica nada.

**Lo cobrado por mesas no alimenta la nómina.** Son dos circuitos sin ninguna
relación: ninguna consulta de `nomina/index.ts` toca `orders`, `tickets` ni
`seats`. Queda escrito acá para que nadie los enlace más adelante «para completar
el cuadro»: cruzarlos volvería la nómina dependiente de una noche floja de
ventas, que no es lo que se le prometió a nadie que trabaja.

**Las marcaciones guardan la línea original del archivo.** El captahuellas
todavía no se eligió. Cuando llegue, la primera interpretación de sus columnas
casi seguro va a estar mal en algo —el orden de día y mes, la zona horaria, qué
marca es entrada—. `marcaciones.bruto` conserva el texto tal cual vino, así que
corregirlo es volver a procesar y no volver a exportar del aparato. La
deduplicación va por `referencia_externa`, que cae en el SHA-256 del bruto cuando
el archivo no trae identificador propio. El cálculo de horas queda pendiente a
propósito: sin el formato real, cualquier fórmula sería una suposición sobre el
dinero de otras personas.

**El dinero de la nómina es entero de centavos de punta a punta.** `bigint` en la
base, `_shared/dinero.ts` en las funciones, y en el navegador el texto del
formulario se convierte separando enteros y centavos, sin multiplicar por 100 un
número con coma. Un redondeo suelto casi siempre coincide; lo que no coincide es
acumular mil líneas. Está probado en `verificacion/aritmetica.mjs`.

**Reservar es un solo `UPDATE` con `WHERE status = 'available'`.** Ante dos
compradores simultáneos, el segundo recibe cero filas y ve el error.

**Al leer el resultado de esa reserva hay que mirar el `id`, no si vino algo.**
Una función `returns seats` que no encuentra fila no devuelve `null`: devuelve
una fila con todos los campos en `null`, que en JavaScript es un objeto
perfectamente verdadero. Confiar en `if (!resultado)` hacía que una silla ya
tomada pareciera reservada y el comprador terminara pagando por un lugar que no
era suyo. Por eso existe `seatOrNull()` en `create-order`.

**Sin secreto de webhook configurado no entra ninguna notificación.** Es
preferible no emitir entradas a emitirlas por pagos que nadie hizo.

**`webhook_events` tiene `unique(provider, external_event_id)`.** Las pasarelas
reintentan hasta recibir un 2xx; sin esa restricción una entrada se emitiría dos
veces.

**Las gráficas usan un solo tono.** Los colores de marca (dorado, ámbar,
plateado) se probaron como paleta categórica y fallaron: dorado y ámbar quedan a
ΔE 7.3, indistinguibles incluso con visión normal, y el plateado se lee gris.
La identidad la llevan las etiquetas.

## Lo que se eliminó y por qué

`js/firma.js` firmaba los tickets con un hash débil y el secreto viajaba al
navegador: cualquiera que leyera el código fuente podía fabricar entradas
válidas. La validación ahora es HMAC-SHA256 dentro de `verify-ticket`.

El PIX se generaba entero en el cliente (payload EMV + CRC16) y el botón "ya
realicé el pago" no verificaba nada. Ahora el cobro lo crea la pasarela y el
pago lo confirma su webhook.

**Mercado Pago se reemplazó por Asaas** (commit «Migrar el cobro de Mercado Pago
a Asaas»). Sus secretos (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`) ya no los usa
ninguna función.

Pagar.me quedó descartado antes de llegar a producción: nunca se cargaron sus
credenciales. Su webhook y su módulo se borraron del repo y del proyecto.

La sección PLATA original (12 mesas × 6 sillas con mapa) se reemplazó por
VIP_PLATA con orden de llegada, y esa a su vez por la `PLATA` actual, que se
elige en el plano.

**El webhook de deploy por HTTPS** (2026-08-14 → 2026-09-12). Se hizo para
esquivar bloqueos del puerto 22, pero era una puerta: endpoint público, token
escrito en `desplegar.sh`, servicio como root que descomprimía lo que le llegara
y respondía OK antes de descomprimir. Se reemplazó por el deploy por SSH y se
retiró del servidor el 2026-09-12 (servicio, script, snippet e `include`).

**El carrusel 80/10/10** de la portada (el afiche al 88% con las fechas vecinas
asomando) se reemplazó por el panorámico. Movía un transform con
`pointerdown`/`pointerup` y en el teléfono deslizar no hacía nada.

`kart-montaje.mp4` (2,1 MB): no lo usaba ningún archivo.

## Secretos

Los de las Edge Functions se cargan con `supabase secrets set` y nunca van al
repo ni a estas notas:

| Secreto | Para qué |
|---|---|
| `ASAAS_API_KEY` | Asaas → Integrações → Chaves de API |
| `ASAAS_WEBHOOK_TOKEN` | el mismo que se puso en el webhook de Asaas |
| `ASAAS_CPF_LOCAL` | CPF del local; todas las cobranzas cuelgan de él |
| `ASAAS_ENV` | `produccion` o `sandbox` |
| `TICKET_HMAC_SECRET` | firma de los códigos de entrada |
| `CRON_SECRET` | respaldo del secreto de cron; el vigente se genera en Postgres |
| `VISITS_SALT` | anonimiza el contador de visitas |
| `SMTP_HOST`, `SMTP_PORT` | `smtp.hostinger.com`, `465` |
| `SMTP_USER`, `SMTP_PASS` | buzón `ventas@enprokart.com` (Hostinger → Correos) |
| `TELEGRAM_BOT_TOKEN` | @BotFather, bot `@Prokart1_bot` |
| `TELEGRAM_CHAT_IDS` | los chats que reciben avisos, separados por coma |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los pone
Supabase solo.

> **Correo y Telegram (2026-09-12).** Sus credenciales estuvieron escritas en
> `_shared/email.ts` y `_shared/telegram.ts`. Desde el 2026-09-12 se leen de los
> secretos de arriba y así están desplegadas `asaas-webhook` (v9),
> `courtesy-ticket` (v15) y `reporte-semanal` (v3), verificado contra la fuente
> descargada. **Los valores viejos siguen siendo los mismos y estuvieron en el
> código: hay que rotarlos** (contraseña del buzón en Hostinger, `/revoke` en
> @BotFather) y cargar los nuevos con `supabase secrets set`; no hace falta
> redesplegar. Si faltan los de Telegram, la función deja
> `telegram/sin configurar` en el log y sigue.

La `anon key` sí es pública y vive en `01 - Entradas/js/config.js`: lo que
protege los datos es RLS, no esconderla.

## Cuentas y roles

`staff_profiles.role` tiene tres valores: `developer`, `admin`, `mesero`.

| Puede | developer | admin | mesero |
|---|---|---|---|
| Gestionar administradores | sí | no | no |
| Gestionar meseros y empleados | sí | sí | no |
| Actuar sobre su propia cuenta | sí | no | no |
| Operar la puerta | sí | sí | sí |

`is_admin()` cuenta al developer como admin —es la llave de todas las políticas
de escritura, y sin eso esa cuenta no entraría a nada—. Lo que los separa es
`is_developer()` y, sobre todo, `puedeActuarSobre()` en
`supabase/functions/_shared/supabase.ts`, que es donde vive la regla: **entre
administradores no hay ninguna acción disponible**. Ni crear, ni editar, ni
degradar, ni reiniciar la clave, ni eliminar. El panel esconde esos botones, pero
quien decide es la Edge Function: llamarla a mano devuelve 403.

### La cuenta de desarrollo — pendiente de entrega

`developer@enprokart.com` existe para construir y mantener el sistema. **Queda
visible en la lista de usuarios**, marcada como tal, aunque un admin no pueda
tocarla: una cuenta con poder total, oculta y permanente dentro del sistema de
otra persona es una puerta trasera, aunque la intención sea buena. Betsimar tiene
que poder ver que existe.

Su clave la eligió el dueño de la cuenta al crearla desde Authentication y no
está en ningún archivo del repo, igual que las demás. Su código de administrador
de 3 dígitos lo genera la migración al azar y se ve en el panel, en **Usuarios →
Tu cuenta**, con esa sesión abierta; también sale de correr
`verificacion/enlazar-cuentas.sql`, que lista rol y código de todas las cuentas
con poder.

> **Al entregar el proyecto hay que eliminar o transferir esta cuenta.** El
> camino: desde la sesión del developer, degradarla a `mesero` en Usuarios (una
> cuenta no puede eliminarse a sí misma, a propósito), y después Betsimar la
> elimina como a cualquier otro mesero. Mientras siga existiendo con rol
> `developer`, hay alguien fuera del local que puede nombrar administradores.
