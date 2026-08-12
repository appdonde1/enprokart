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
Pasarela: Pagar.me (PIX)

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
`sections.price_cents`. Si el cliente manda un precio, se ignora.

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

**El webhook acepta Basic Auth o firma HMAC y rechaza si ninguno valida.**
Pagar.me no documenta públicamente el esquema, así que se soportan ambos. Sin
credencial configurada no entra nada: preferible eso a aceptar pagos falsos.

**`webhook_events` tiene `unique(provider, external_event_id)`.** Pagar.me
reintenta; sin esa restricción una entrada se emitiría dos veces.

**Las gráficas usan un solo tono.** Los colores de marca (dorado, ámbar,
plateado) se probaron como paleta categórica y fallaron: dorado y ámbar quedan a
ΔE 7.3, indistinguibles incluso con visión normal, y el plateado se lee gris.
La identidad la llevan las etiquetas.

## Lo que se eliminó y por qué

`js/firma.js` firmaba los tickets con un hash débil y el secreto viajaba al
navegador: cualquiera que leyera el código fuente podía fabricar entradas
válidas. La validación ahora es HMAC-SHA256 dentro de `verify-ticket`.

El PIX se generaba entero en el cliente (payload EMV + CRC16) y el botón "ya
realicé el pago" no verificaba nada. Ahora el cobro lo crea Pagar.me y el pago
lo confirma su webhook.

La sección PLATA original (12 mesas × 6 sillas con mapa) se reemplazó por
VIP_PLATA.

## Secretos

Nunca en el repo ni en estas notas. Se cargan con `supabase secrets set`:
`PAGARME_SECRET_KEY`, `PAGARME_WEBHOOK_USER`, `PAGARME_WEBHOOK_PASSWORD`,
`PAGARME_WEBHOOK_SECRET`, `TICKET_HMAC_SECRET`, `CRON_SECRET`.

La `anon key` sí es pública y vive en `01 - Entradas/js/config.js`: lo que
protege los datos es RLS, no esconderla.
