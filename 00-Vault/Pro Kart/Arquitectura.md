# Arquitectura · Pro Kart Web

Nota viva: refleja cómo está armado el sistema hoy. Se edita, no se acumula.
La historia de cada trabajo va en [[Bitácora]].

## Panorama

```
01 - Entradas/            sitio estático, sin build ni bundler
  index.html              compra en 3 pasos
  verificar.html          validación de entradas (personal)
  admin/                  panel de personal
supabase/
  migrations/             esquema, RLS, funciones, semilla
  functions/              Edge Functions en Deno
```

Proyecto Supabase: `tgilgfwxtghcqskfyzif`
Pasarela: Mercado Pago (PIX por la API de Pagos)

## Secciones del evento

| Código | Lugares | Asignación | Mapa visible |
|---|---|---|---|
| `UNICA` | 1 mesa × 8 sillas | el comprador elige | sí |
| `ORO` | 8 mesas × 6 sillas = 48 | el comprador elige | sí |
| `VIP_PLATA` | 120 mesas × 4 sillas = 480 | orden de llegada | no |
| `GENERAL` | sin asiento, sin tope | no reserva nada | no |

`sections.assignment_mode` (`manual` / `auto_fcfs` / `none`) es lo que decide el
comportamiento, no el nombre de la sección. Agregar una sección nueva no exige
tocar código: el frontend se arma con lo que haya en la base.

## Decisiones que no se ven en el código

**El precio nunca llega desde el navegador.** `create-order` lo lee de
`sections.price_cents` en cada venta. Si el cliente manda un precio, se ignora:
probado mandando R$ 1 con el precio real en R$ 199,99, y se cobró el de la base.
Lo edita el admin desde el panel (pestaña Salón); RLS rechaza a cualquier otro
rol, y un trigger deja registrado el cambio en `price_updated_at`.

**Se eligió la API de Pagos de Mercado Pago, no Checkout Pro.** Checkout Pro
lleva al comprador al sitio de Mercado Pago y lo trae de vuelta; acá se pidió
que no saliera del sitio, así que se crea el pago con `payment_method_id: "pix"`
y la página muestra el QR (`qr_code_base64`) y el código copia-e-cola
(`qr_code`) que devuelve la respuesta.

**El webhook de Mercado Pago solo avisa que algo cambió.** No se confía en el
cuerpo de la notificación: se consulta `GET /v1/payments/{id}` y el estado real
sale de ahí. La firma se valida con HMAC-SHA256 sobre
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, donde `data.id` se toma de la
query string y en minúsculas.

**`seats.held_by` no se expone.** Guarda el id de la orden, que es el token con
el que el comprador consulta su propio pago. Si el mapa público lo mostrara,
cualquiera podría leer órdenes ajenas y quedarse con códigos de entrada válidos.
Por eso el `GRANT` sobre `seats` es por columna: `anon` solo ve
`id, table_id, number, status`. Realtime respeta ese límite.

**Emitir entradas y marcar pagos no tiene policy de escritura para ningún rol.**
Solo ocurre dentro de Edge Functions con `service_role`. Ni siquiera un admin
puede marcar una orden como pagada desde el panel.

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
tu mesa»; «puedes», no «podés». Vale para los textos de pantalla y para los
mensajes de error de las Edge Functions, que llegan al comprador tal cual.

**Las secciones sin plano no dibujan mesas en el panel.** Plata asigna por orden
de llegada y su mapa no se muestra a nadie: pintar sus 120 mesas en el editor era
pedir que alguien revisara una por una algo que nadie elige a mano. La regla es
por `assignment_mode`, no por el nombre de la sección.

**El editor del salón no guarda solo.** Los precios y las sillas se acumulan en
un borrador y salen en una sola tanda, con la cuenta de lo pendiente a la vista y
aviso al salir. Antes cada clic escribía en la base, y un clic de más ya era un
cambio hecho sobre lo que se cobra.

**El plano del comprador es una hoja clara sobre una página oscura.** Es el único
momento de la compra en que se mira el salón, y se ve distinto a propósito. Las
sillas no se dibujan: se vende la mesa entera, así que su cantidad es un dato y
no una forma que haya que contar. La posición sale de `pos_x`/`pos_y`, lo mismo
que edita el panel, así que agregar una fila no obliga a tocar el dibujo.

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
compradores simultáneos, el segundo recibe cero filas y ve el error. En VIP
Plata se suma `FOR UPDATE SKIP LOCKED` para que cada uno tome la siguiente silla
libre en vez de pelear por la misma.

**Al leer el resultado de esa reserva hay que mirar el `id`, no si vino algo.**
Una función `returns seats` que no encuentra fila no devuelve `null`: devuelve
una fila con todos los campos en `null`, que en JavaScript es un objeto
perfectamente verdadero. Confiar en `if (!resultado)` hacía que una silla ya
tomada pareciera reservada y el comprador terminara pagando por un lugar que no
era suyo. Por eso existe `seatOrNull()` en `create-order`.

**Sin secreto de webhook configurado no entra ninguna notificación.** Es
preferible no emitir entradas a emitirlas por pagos que nadie hizo.

**`webhook_events` tiene `unique(provider, external_event_id)`.** Mercado Pago
reintenta hasta recibir un 2xx; sin esa restricción una entrada se emitiría dos
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
realicé el pago" no verificaba nada. Ahora el cobro lo crea Mercado Pago y el
pago lo confirma su webhook.

Pagar.me quedó descartado antes de llegar a producción: nunca se cargaron sus
credenciales. Su webhook y su módulo se borraron del repo y del proyecto.

La sección PLATA original (12 mesas × 6 sillas con mapa) se reemplazó por
VIP_PLATA.

## Secretos

Nunca en el repo ni en estas notas. Se cargan con `supabase secrets set`:

| Secreto | De dónde sale | Estado |
|---|---|---|
| `TICKET_HMAC_SECRET` | generado | cargado |
| `CRON_SECRET` | generado | cargado |
| `MP_ACCESS_TOKEN` | Mercado Pago → Tus integraciones → Credenciales | cargado (prueba) |
| `MP_WEBHOOK_SECRET` | Mercado Pago → Webhooks → Configurar notificación | cargado |

La URL a registrar en Mercado Pago como notificación es
`https://tgilgfwxtghcqskfyzif.supabase.co/functions/v1/mercadopago-webhook`.

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
