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

**Reservar es un solo `UPDATE` con `WHERE status = 'available'`.** Ante dos
compradores simultáneos, el segundo recibe cero filas y ve el error. En VIP
Plata se suma `FOR UPDATE SKIP LOCKED` para que cada uno tome la siguiente silla
libre en vez de pelear por la misma.

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
| `MP_ACCESS_TOKEN` | Mercado Pago → Tus integraciones → Credenciales | **falta** |
| `MP_WEBHOOK_SECRET` | Mercado Pago → Webhooks → Configurar notificación | **falta** |

La URL a registrar en Mercado Pago como notificación es
`https://tgilgfwxtghcqskfyzif.supabase.co/functions/v1/mercadopago-webhook`.

La `anon key` sí es pública y vive en `01 - Entradas/js/config.js`: lo que
protege los datos es RLS, no esconderla.
