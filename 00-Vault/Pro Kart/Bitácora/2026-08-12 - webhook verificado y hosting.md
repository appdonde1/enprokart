# Webhook verificado y decisión de hosting

- Fecha: 2026-08-12
- Estado: Webhook funcionando · publicación del sitio pendiente

## Webhook de Mercado Pago

Se cargó `MP_WEBHOOK_SECRET` y se verificó armando notificaciones a mano:

- Con firma correcta → 200, y el webhook **consultó el pago en la API de
  Mercado Pago** (devolvió su `external_reference`), buscó la orden y, al no
  existir, la descartó dejando el motivo anotado.
- Con la firma alterada → 401.

Queda sin probar el último tramo: emitir la entrada cuando el pago está
**aprobado**. Un PIX de prueba se queda en `pending` hasta que alguien lo pague,
así que hace falta una compra real para cerrar esa parte.

## Hosting: el VPS quedó descartado por ahora

El VPS de Hostinger (`2.24.109.98`, Ubuntu 24.04) respondía al crearse y después
dejó de responder por completo — ni ping ni SSH — durante más de 16 minutos. La
API lo seguía reportando como `running` y **no registró ninguna acción de
reinstalación**, así que no fue un rebuild.

Dato útil para el futuro: **la API de Hostinger no permite adjuntar claves SSH a
un VPS ya creado**. La ruta `virtual-machines/{id}/public-keys` es solo de
lectura; por API únicamente se puede cambiar la contraseña de root o recrear el
servidor. La clave se carga desde hPanel.

Se decidió publicar en Netlify mientras tanto. Conviene igual: da HTTPS sin
configurar nada, y el botón de copiar el código PIX **no funciona sin HTTPS** en
la mayoría de los navegadores (hay un método alternativo, pero es peor).

`netlify.toml` deja la carpeta `01 - Entradas` como raíz del sitio y marca
`/admin/*` y `verificar.html` como no indexables: son pantallas del personal y
no tienen por qué aparecer en buscadores.

## Dominio

`enprokart.com` apunta hoy a `2.57.91.91`, que no es el VPS. Cuando se defina
dónde queda el sitio hay que apuntar el registro A al destino correcto, o
conectarlo como dominio propio en Netlify.

## Pendiente

1. Token de Netlify para publicar (el que se probó dio 401: era el secreto de
   Mercado Pago).
2. Compra real de punta a punta con un PIX efectivamente pagado.
3. Usuarios del personal y sus filas en `staff_profiles`.
4. Confirmar los precios de Mesa Única y VIP Plata.
