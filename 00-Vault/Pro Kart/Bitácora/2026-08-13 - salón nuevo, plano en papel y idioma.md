# Salón nuevo, plano en papel, reservas por admin e idioma latino

- Fecha: 2026-08-13
- Estado: Desplegado y verificado · **falta mirarlo en un navegador** y subir a
  Netlify

## Qué se hizo

**El salón creció y el plano se rehízo.** Se aplicó la migración de las filas
nuevas: A y B pasan a 12 mesas, C a tres filas de nueve, y las tres mesas únicas
—U1, U2, U3— quedan en la columna del centro, cada una en su sección para poder
tener precio propio.

**El plano del comprador es ahora una hoja de plano.** Papel claro, cuadrícula
roja, tarima en T arriba y la pasarela entre A y B. El sitio es casi negro y el
plano no: es el único momento de la compra en que la persona mira el salón y
decide dónde se sienta, y se ve distinto a propósito. Reemplaza al SVG que se
dibujaba a mano —518 líneas de JavaScript por 173— porque una grilla de CSS
responde sola al ancho de la pantalla sin volver a dibujar nada.

**No se dibujan las sillas.** Se vende la mesa entera, así que cuántas sillas
tiene es un dato, no una forma que haya que contar con la vista.

**El editor del salón dejó de guardar solo.** Antes cada precio tenía su botón y
cada silla escribía en la base al tocarla: un clic de más ya era un cambio hecho.
Ahora todo se acumula en un borrador, lo pendiente se marca en naranja, una barra
pegada abajo dice cuántos cambios hay y sale todo en una sola tanda. Salir del
módulo o cerrar la pestaña con algo sin guardar avisa.

**Plata dejó de dibujarse en el editor.** No por ser Plata: **las secciones sin
plano no dibujan mesas**, y Plata asigna por orden de llegada. Pintar sus 120
mesas era pedir que alguien revisara una por una algo que nadie elige a mano. Se
resume en una fila con su capacidad. La sección sigue existiendo y vendiéndose.

**La portada tiene botón para subir la imagen.** Era un campo de texto donde
había que escribir el nombre del archivo: si no coincidía, la portada quedaba con
la genérica y nadie sabía por qué. Ahora sube al bucket `medios` y muestra una
previa. La ruta sigue siendo editable, para poder apuntar a `placeholders/`.

**Se construyó la pantalla de Reservas.** `courtesy-ticket` estaba completa y
desplegada desde hacía días pero **ningún archivo del panel la llamaba**: las
reservas por admin no se hacían en ningún lado. Ahora hay pantalla: invitado,
cuántas personas, mesas elegidas en un plano, motivo y el código de 3 dígitos.

**El idioma pasó de voseo a tuteo.** «Elige» en vez de «Elegí», «puedes» en vez
de «podés». 49 líneas en 18 archivos, textos de pantalla y mensajes de error de
las Edge Functions. Ver [[Arquitectura]].

## Dos bugs que aparecieron al aplicar

**La migración del salón no podía correr.** Su guarda usaba `tickets.table_id`,
que no existe: la entrada guarda `table_code`, el código y no el id, justamente
para que siga diciendo dónde se sentaba alguien aunque el salón cambie. Se
corrigió la guarda.

**Una cuenta que hubiera tocado un sueldo no se podía eliminar.**
`nomina_ajustes.hecho_por` apuntaba a `auth.users` con `on delete set null`, y
ese SET NULL es un UPDATE que el trigger de inmutabilidad rechaza. Las dos reglas
eran correctas por separado y se contradecían juntas; `staff-admin` fallaba a
mitad de camino, dejando el perfil borrado y el usuario de auth vivo.

Ganó la del registro: un ajuste no se reescribe nunca. El ajuste ahora **copia el
nombre de su autor** al hacerse y `hecho_por` quedó como uuid suelto, sin llave.
Es el mismo criterio que la línea de nómina copiando al empleado al cerrar la
semana. Migración `20260813000001`.

Apareció limpiando datos de prueba: borrar la semana de prueba disparó el
trigger, y borrar la cuenta que la había ajustado también.

## Cómo se verificó

Contra el proyecto real.

- `node --check` en los 15 JS del navegador y `deno check` en las 8 Edge
  Functions: pasan.
- `privacidad` 8/8 · `nomina` 10/10 · `ciclo-vida` 9/9 · `marcaciones` 7/7.
- **El circuito completo de una reserva por admin**, de punta a punta: sin código
  da 403 con `bad_code`; con código incorrecto, lo mismo; pedir 20 personas en
  una mesa de 6 se rechaza con el número exacto; con el código correcto emite 4
  entradas en A1, la mesa queda tomada, aparece en Operaciones marcada como
  cortesía, se anula y la mesa vuelve a estar libre.
- Eliminar una cuenta que había hecho ajustes de nómina: ahora funciona. Antes de
  la migración, fallaba.

`jerarquia.mjs` **no se volvió a correr**: necesita la sesión de
`developer@enprokart.com` y su clave cambió en el primer ingreso, que es lo que
tenía que pasar. Pasó 10/10 el 12/08 y su lógica no se tocó desde entonces.

Los datos de prueba se borraron. La base quedó con los dos legajos reales, sin
nómina, sin marcaciones y con las tres cuentas de siempre.

**Falta mirarlo en un navegador.** Todo lo de este día es interfaz y no hay forma
de verla desde acá: el plano en papel, el editor con su barra de guardado, la
subida de portada y la pantalla de reservas están verificados por sintaxis y por
backend, no por vista.

## Archivos tocados

- `supabase/migrations/20260812000016_salon_filas_nuevas.sql` (guarda corregida)
- `supabase/migrations/20260813000001_el_ajuste_guarda_a_su_autor.sql` (nuevo)
- `supabase/functions/nomina/`, `courtesy-ticket/`, `create-order/`,
  `crear-solicitud/`, `staff-admin/`
- `01 - Entradas/js/app.js` (el plano), `css/plano.css`
- `01 - Entradas/admin/js/admin.js` (editor del salón, subida de portada)
- `01 - Entradas/admin/reservas.html`, `js/reservas.js` (nuevos)
- `01 - Entradas/admin/index.html`, `css/admin.css`, `js/panel-base.js`
- 18 archivos más, solo por el cambio de idioma
