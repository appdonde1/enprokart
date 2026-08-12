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

## Pendiente

1. Cargar `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`.
2. Registrar la URL del webhook en el panel de Mercado Pago.
3. Probar una compra real de punta a punta con credenciales de prueba.
4. Crear los usuarios del personal y sus filas en `staff_profiles`.
5. Confirmar los precios de Mesa Única y VIP Plata, que siguen con los valores
   que se pusieron por defecto.
