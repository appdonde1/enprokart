# Mercado Pago y precios editables desde el panel

- Fecha: 2026-08-12
- Estado: Desplegado · falta cargar credenciales de Mercado Pago

## Qué se hizo

**Cambio de pasarela.** Se reemplazó Pagar.me por Mercado Pago. Se pidió primero
Checkout Pro, pero al aclararse que el comprador no debe salir del sitio se usó
la **API de Pagos** con `payment_method_id: "pix"`: Mercado Pago devuelve el QR
en base64 y el código copia-e-cola, y la página los muestra sin redirigir.

El paso de pago ahora tiene el QR de Mercado Pago y, debajo, el código PIX con
los primeros seis caracteres visibles y un botón de copiar — el código completo
tiene cientos de caracteres y no aporta nada mostrarlo entero.

**Precios editables.** En la pestaña Salón del panel, cada sección tiene su
precio editable. Solo lo ve y lo puede guardar el rol admin; RLS rechaza a
cualquier otro aunque llame a la API directo. Ver [[Arquitectura]].

## Archivos tocados

- `supabase/migrations/20260812000001_mercadopago_checkout.sql`
- `supabase/functions/_shared/mercadopago.ts` (nuevo)
- `supabase/functions/mercadopago-webhook/` (nuevo)
- `supabase/functions/create-order/`, `get-order-status/`
- Eliminados: `supabase/functions/pagarme-webhook/`, `_shared/pagarme.ts`
- `01 - Entradas/index.html`, `js/app.js`, `css/style.css`
- `01 - Entradas/admin/js/admin.js`, `admin/css/admin.css`

## Cómo se verificó

Contra el proyecto real, no en teoría:

- **El precio se consulta antes de vender.** Se puso ORO en R$ 199,99 y se
  intentó una compra mandando `amount_cents: 100` desde el cliente. La orden
  quedó registrada en 19999. El precio se restauró a R$ 150.
- **`price_updated_at` se marca solo** al cambiar el precio (trigger).
- **El webhook rechaza firmas inválidas**: sin `x-signature` y con una firma
  falsa devuelve 401 en ambos casos.
- **El webhook viejo de Pagar.me ya no existe** en el proyecto (404).
- **Una compra que falla en la pasarela libera la silla**: 0 sillas ocupadas
  después del intento.
- Las funciones pasan `deno check` y el JavaScript pasa `node --check`.

## Con credenciales de prueba cargadas

Se cargó `MP_ACCESS_TOKEN` de prueba y se hicieron compras reales contra
Mercado Pago. Aparecieron dos problemas, los dos corregidos:

**El email de relleno era inválido.** El formulario no pide correo, así que se
armaba uno con dominio `.local` y Mercado Pago lo rechazaba con
`payer.email must be a valid email`. Ahora el dominio es válido y además se
agregó un campo de correo **opcional**: quien lo deje recibe el comprobante de
Mercado Pago.

**Una silla ya reservada no cortaba la venta.** `hold_seat_manual` devuelve una
fila con todos los campos en `null` cuando no reserva nada, y eso en JavaScript
es un objeto verdadero: el código creía haber reservado y seguía hasta el cobro.
El comprador podía terminar pagando por un lugar que no era suyo. Se corrigió
mirando el `id` de la fila. Reprobado: la silla tomada devuelve 409 y la de al
lado vende normal.

## Estado verificado de punta a punta

- Compra real: orden creada, QR de Mercado Pago (3784 caracteres en base64) y
  copia-e-cola de 165 caracteres empezando en `000201`.
- El monto sale de la base: R$ 150 para ORO.
- La silla queda `held` mientras el pago está pendiente.
- Un segundo comprador sobre la misma silla recibe 409.
- Se borraron las órdenes de prueba y se liberaron las sillas.

## Pendiente

1. Cargar `MP_WEBHOOK_SECRET` y registrar la URL del webhook en Mercado Pago.
   Sin eso el webhook rechaza todo y ningún pago llega a confirmarse.
2. Crear los usuarios del personal y sus filas en `staff_profiles`.
3. Confirmar los precios de Mesa Única y VIP Plata, que siguen con los valores
   que se pusieron por defecto.
