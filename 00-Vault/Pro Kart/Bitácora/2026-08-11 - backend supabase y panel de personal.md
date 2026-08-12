# Backend Supabase, panel de personal y logo

- Fecha: 2026-08-11
- Estado: Código completo · pendiente de desplegar

## Qué se hizo

Se pasó el sitio de una simulación en `localStorage` a un sistema real con
Supabase y cobro por Pagar.me. Ver [[Arquitectura]] para el detalle de cómo
quedó armado.

**Base de datos.** Esquema multi-evento (eventos, secciones, mesas, sillas,
órdenes, tickets, webhooks, personal), políticas RLS, funciones de reserva y
expiración de holds por `pg_cron`, y la semilla con las cuatro secciones.

**Edge Functions.** `create-order` (cobra por Pagar.me), `pagarme-webhook`
(confirma el pago y emite la entrada), `get-order-status`, `verify-ticket` y
`expire-holds`.

**Compra.** Disponibilidad sincronizada por Realtime, badge de estado al pasar
el mouse sobre mesas y sillas, aviso con Aceptar/Cancelar en VIP Plata, y
WhatsApp como dato obligatorio.

**Panel de personal.** Roles admin y mesero, editor visual del salón con
stepper por mesa, contabilidad con gráficas, y apertura de eventos que copia la
distribución del salón.

**Logo.** Se recortó el fondo blanco conservando los cuadros de las banderas.

## Archivos tocados

- `supabase/migrations/` (5 archivos) y `supabase/functions/` (5 funciones + `_shared/`)
- `01 - Entradas/js/app.js`, `verificar.js`, `config.js`, `supabaseClient.js`
- `01 - Entradas/index.html`, `verificar.html`, `css/style.css`
- `01 - Entradas/admin/` (panel nuevo completo)
- Eliminado: `01 - Entradas/js/firma.js`

## Cómo se verificó

- Las cinco Edge Functions pasan `deno check`.
- Todo el JavaScript pasa `node --check`.
- Las páginas y assets se sirven correctamente (probado en un servidor local).
- Se verificó que cada `getElementById` del JS exista en su HTML.
- La paleta de las gráficas se corrió por el validador de contraste y CVD.
- Los detalles de la API de Pagar.me se confirmaron contra su documentación
  oficial, no de memoria: el campo `code` admite 52 caracteres (un UUID entra),
  `expires_in` va en segundos y el QR viene en `charges[].last_transaction`.

**Nada se probó todavía contra la base real**: falta el login de Supabase, así
que el esquema no se aplicó ni se ejecutó una compra de punta a punta.

## Pendiente

1. `npx supabase login` y `npx supabase link --project-ref tgilgfwxtghcqskfyzif`.
2. Pegar la `anon key` en `01 - Entradas/js/config.js`.
3. `npx supabase db push` y desplegar las funciones.
4. Cargar los secretos de Pagar.me y registrar la URL del webhook.
5. Crear los usuarios del personal y su fila en `staff_profiles` con el rol.
6. Probar una compra completa contra el sandbox de Pagar.me, incluida la
   concurrencia (dos pestañas sobre la misma silla) y el doble escaneo de un QR.
7. Revisar los precios de la semilla: los de UNICA y VIP_PLATA se pusieron por
   defecto y hay que confirmarlos.
