# Cierre de secciones Plata y General, grilla Plata 6x11 y sincronización de repositorio

Trabajo realizado el 26 de septiembre de 2026.

## 1. Cierre y apertura de secciones en el panel de administración

- **Problema:** En el panel de administración (`admin.js`), en la pestaña *Salón*, solo existía el bloque de control para abrir/cerrar las secciones de **Oro** (`bloqueVentaOro`). No había forma de cerrar o abrir individual o grupalmente las secciones de **Plata** y **General**.
- **Solución:**
  - Se generalizó la lógica de control con `bloqueVentaGrupo()` y `bloqueVentas()`.
  - Ahora se muestran tres bloques de venta bien diferenciados con sus colores de nivel:
    - **Oro a la venta** (dorado: `var(--oro)`): controles grupales «Abrir todas» / «Cerrar todas» e interruptores para A, B, C y Mesas Únicas.
    - **Plata a la venta** (plateado: `var(--plata)`): controles de apertura/cierre e interruptor para la sección Plata.
    - **General a la venta** (azul: `var(--info)`): controles de apertura/cierre e interruptor para las secciones de acceso general / sin plano.
  - En las tarjetas sin plano (`bloqueSinMapa`), ahora se refleja visualmente si están cerradas (`No está a la venta` y estilo atenuado `.salon-bolsa--cerrada`).
  - Los botones grupales en `cablearSalon()` ahora filtran correctamente por `data-grupo`.

## 2. Actualización de la grilla de Plata a 6x11 (66 mesas)

- **Ajuste:** La sección Plata se reconfigura de 15x6 (90 mesas) a **6 filas de 11 columnas** (66 mesas de 4 sillas = 264 lugares).
- **Protección de compras en primera fila:** Las 5 mesas ya vendidas en Plata (**P7, P8, P9, P11 y P12**) se mantuvieron explícitamente en la primera fila (`pos_y = 1`), asegurando que ningún comprador con entrada emitida pierda su ubicación delantera.
- **Migración:** Se generó el script SQL [`supabase/migrations/20260926000001_plata_grid_6x11.sql`](../../supabase/migrations/20260926000001_plata_grid_6x11.sql) para aplicarlo en Supabase.
- **Plano dinámico:** Tanto el plano de la web (`app.js` / `plano.css`) como el del panel (`admin.js` / `admin.css`) leen el ancho por `pos_x` dinámicamente y se adaptan a las 11 columnas.

## 3. Despliegue y Sincronización

- **VPS:** Se desplegó la versión actualizada a producción vía SSH con `./desplegar.sh` (HTTP 200 en https://enprokart.com).
- **GitHub:** Se vinculó el repositorio remoto `https://github.com/appdonde1/enprokart.git` y se publicaron las ramas `main`, `personal-y-nomina` y `master`, incluyendo todo el código, migraciones y la bóveda de documentación (`00-Vault/`).
