# Verificación

Scripts que se corren con Node contra el proyecto de Supabase real. **Sin
dependencias**: usan `fetch`, `node:test` y `node:assert`, que vienen con el
runtime. No hay `package.json` ni `npm install`, igual que el resto del proyecto,
que es estático y no tiene build ni bundler.

Hace falta **Node 22.18 o más nuevo** (probado en 24.19), porque `aritmetica.mjs`
importa `_shared/dinero.ts` directo: prueba el módulo que usan las Edge
Functions, no una copia.

## Variables de entorno

Ninguna clave vive en el repo. Se pasan al correr:

| Variable | Qué es |
|---|---|
| `PK_ANON` | La anon key del proyecto. Es la misma que está en `01 - Entradas/js/config.js`; es pública. |
| `PK_URL` | La URL del proyecto. Opcional: por defecto usa la de siempre. |
| `PK_DEV_EMAIL`, `PK_DEV_PASS` | La cuenta `developer@enprokart.com`, con la clave ya cambiada. |
| `PK_ADMIN_EMAIL`, `PK_ADMIN_PASS` | Una cuenta con rol `admin`. |
| `PK_ADMIN_CODE` | El código de 3 dígitos de esa cuenta admin. Se lo ve en el panel, en Usuarios. |
| `PK_MESERO_EMAIL`, `PK_MESERO_PASS` | Opcional. Si falta, `privacidad.mjs` saltea la prueba del mesero. |

En PowerShell:

```powershell
$env:PK_ANON      = "eyJhbGciOi..."
$env:PK_ADMIN_EMAIL = "betsimar@enprokart.com"
$env:PK_ADMIN_PASS  = "..."
$env:PK_ADMIN_CODE  = "123"
$env:PK_DEV_EMAIL   = "developer@enprokart.com"
$env:PK_DEV_PASS    = "..."
```

## Correr

```powershell
node --test verificacion/aritmetica.mjs      # sin red, no necesita nada más
node --test verificacion/jerarquia.mjs
node --test verificacion/privacidad.mjs
node --test verificacion/nomina.mjs
node --test verificacion/ciclo-vida.mjs
node --test verificacion/marcaciones.mjs

node --test verificacion/                    # todos juntos
```

## Qué comprueba cada uno

| Script | Red | Qué comprueba |
|---|---|---|
| `aritmetica.mjs` | no | R$ 80/día con jornada de 8 h da exactamente R$ 10,00/hora. Una lista de sueldos suma en centavos igual que sumada a mano. La deriva del punto flotante al acumular mil líneas. Un bono del 33 % sobre R$ 80 da el mismo total por dos caminos. |
| `jerarquia.mjs` | sí | Un admin recibe **403** al crear, editar, degradar o eliminar a otro admin o al developer, y **400** al intentarlo consigo mismo. El developer sí puede. Un mesero recibe 403 en los tres módulos nuevos. |
| `privacidad.mjs` | sí | `anon` no lee `empleados`, `marcaciones` ni las tablas de nómina; un admin autenticado tampoco las lee directo, solo por la Edge Function. `admin_code` no es legible por nadie desde el navegador. |
| `nomina.mjs` | sí | Un ajuste sin motivo se rechaza; uno sin código correcto se rechaza con 403 y `bad_code`; uno correcto queda con quién y cuándo. Cerrar una semana y después subirle el sueldo al empleado no altera la semana cerrada. No hay acción para editar ni borrar un ajuste. |
| `ciclo-vida.mjs` | sí | Retirar saca de la lista activa y muestra en Retirados con fecha y motivo; reingresar devuelve conservando código e historial. Ninguna acción borra un legajo. |
| `marcaciones.mjs` | sí | Importar el mismo archivo dos veces no duplica; el hash del bruto cubre los archivos sin identificador propio; la línea original queda guardada tal cual; una fecha ilegible se descarta sin romper el resto. |

Los scripts con red **crean datos de prueba** en el proyecto real: cuentas con
correo `verificacion-…@enprokart.com` y empleados apellidados «Prueba». Las
cuentas se borran al terminar. Los empleados **no**: ningún camino borra un
legajo, así que quedan retirados con el motivo «Empleado de prueba de
verificación». Se los ve marcando *Ver retirados* en Empleados.

## Lo que no cubren

- **La ficha impresa.** Se revisa a mano: `ficha.html?id=…` → Imprimir → Guardar
  como PDF, y se mira que entre en una hoja, sin barra lateral ni botones, y que
  no falte ningún dato.
- **El teléfono.** Se levanta `01 - Entradas/serve.ps1` y se abre desde el
  celular en la misma red WiFi. Lo que hay que mirar es que las tablas de
  Empleados, Nómina y Usuarios se apilen como fichas, igual que Operaciones.
- **El captahuellas real**, que todavía no se eligió.

## `enlazar-cuentas.sql`

No es una prueba: es el bloque que enlaza los legajos de Betsimar, Jonathan y la
cuenta de desarrollo con sus cuentas de `auth.users`, por correo. La migración ya
lo corre, pero las cuentas se crean a mano desde el panel de Supabase y puede que
no existieran todavía. Se pega en el SQL Editor y se puede correr las veces que
haga falta.
