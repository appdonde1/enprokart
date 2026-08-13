# Personal: áreas, credenciales, legajos y nómina

- Fecha: 2026-08-12
- Estado: **Desplegado y verificado contra el proyecto real.** Falta subir el
  panel a Netlify y la revisión a mano de la ficha impresa y del teléfono.

## Qué se hizo

El panel administraba el evento pero no a la gente que lo hace funcionar. Había
cuentas de acceso creadas a mano desde una Edge Function, sin ninguna pantalla
para gestionarlas, y ningún registro de quién trabaja en el local, en qué área ni
cuánto cobra.

**La separación que ordena todo esto: el legajo de un empleado no es una cuenta
de acceso.** Alguien de cocina o limpieza tiene ficha y sueldo pero nunca entra
al panel; un mesonero tiene las dos cosas. El botón «Dar acceso al panel» es lo
único que las enlaza. Mezclarlas habría creado decenas de cuentas que nadie usa.

**Tercer rol, `developer`.** Solo él edita o revoca administradores. Entre
administradores no hay ninguna acción disponible —ni sobre otro admin ni sobre la
cuenta propia— y la regla se aplica en `puedeActuarSobre()` dentro de la Edge
Function, no escondiendo botones. La cuenta de desarrollo queda visible en la
lista, marcada como tal: ver [[Arquitectura]], sección «Cuentas y roles», que
además tiene escrito cómo eliminarla al entregar el proyecto.

**Cuatro módulos nuevos, grupo Personal en la barra:** Empleados (lista, alta,
catálogos e importación de marcaciones), Nómina, Usuarios —la pantalla que nunca
se había construido, sobre el backend que ya existía— y la ficha imprimible.

**La nómina se cierra por semana y cada semana guarda su copia de los números.**
Todo cambio de sueldo, bono o descuento exige motivo y el código de administrador
de 3 dígitos, el mismo que ya protege las cortesías, comparado en el servidor.
Los ajustes no se editan ni se borran: hay un trigger que lo impide incluso desde
`service_role`.

**Lo cobrado por mesas no toca la nómina.** Ninguna consulta de `nomina` lee
`orders`, `tickets` ni `seats`. Quedó escrito en el código y en la nota de
arquitectura para que nadie los enlace más adelante.

## Decisiones

**Nombres en español, contra la convención del esquema.** El resto de la base
está en inglés (`orders`, `staff_profiles`, `ad_campaigns`). El módulo de
Personal va en español porque así se especificó y porque queda como un bloque
coherente en sí mismo. Precedente: la función `registrar_visita`.

**El captahuellas todavía no está elegido**, así que no se escribió el lector de
un archivo que nadie vio. Se dejó el hueco con la forma correcta: `marcaciones`
guarda la línea original en `bruto`, y la pantalla de importación deja mapear las
columnas a mano en vez de asumir un formato, incluido el orden de día y mes. El
cálculo de horas queda pendiente: sin el formato real, cualquier fórmula sería
una suposición sobre el dinero de otras personas.

**`is_admin()` ahora cuenta al developer.** Es la llave de todas las políticas de
escritura y `panel-base.js` exigía el mismo rol; sin ampliarla, esa cuenta habría
quedado sin acceso a nada. Se agregó `is_developer()` aparte para la jerarquía, y
las tres funciones que comparaban `role !== "admin"` (`operaciones`,
`courtesy-ticket`, `solicitud-accion`) pasaron a usar el helper compartido.

**La cuenta de desarrollo se crea a mano desde Supabase**, no desde una
migración: hacerlo en SQL habría dejado una clave escrita en el historial de git.
La migración solo la enlaza por correo, y avisa con `raise notice` en vez de
fallar si todavía no existe.

## El dinero, en enteros

`salario_cents` y todos los `*_cents` son `bigint`. `_shared/dinero.ts` es la
única fuente de cálculo: los porcentajes se pasan a puntos básicos enteros antes
de dividir y se redondea una sola vez. En el navegador, «80,00» se convierte
separando enteros y centavos, sin multiplicar por 100 un número con coma.

Un dato que salió de escribir las pruebas: un redondeo suelto casi siempre
coincide con el camino ingenuo. `8000 * 0.33` da 2640 exacto. Lo que no coincide
es **acumular**: sumar `0.1 + 0.2` mil veces en reales da 300,0000000000056. Por
eso la prueba afirma eso y no lo otro.

## Qué se desplegó

1. `20260812000015_personal.sql` aplicada al proyecto real con `db push`. La
   `20260812000016_salon_filas_nuevas.sql`, que es de otro trabajo, se apartó un
   momento para que el push no la arrastrara, y se devolvió enseguida: sigue
   pendiente.
2. `developer@enprokart.com` creada por la API de administración, con clave
   temporal y `must_change_password`. Su perfil quedó con rol `developer`.
3. Las seis Edge Functions: `empleados` y `nomina` nuevas, y `staff-admin`,
   `operaciones`, `courtesy-ticket` y `solicitud-accion` con el control de rol
   cambiado.

**Los correos reales llevan la inicial del apellido** —`betsimart@` y
`jonathang@`, no `betsimar@` y `jonathan@`—, así que la semilla de la migración
creó los dos legajos pero no los enlazó con sus cuentas. Se corrigió en la base y
en el archivo de la migración, para que un despliegue desde cero no lo repita.

## Cómo se verificó

Contra el proyecto real, no en teoría.

- `deno check` en las ocho Edge Functions: pasa.
- `node --check` en los 14 JS del navegador y los 7 de verificación: pasa.
- **`aritmetica.mjs`: 10 de 10.** Importa `_shared/dinero.ts` directo, así que
  prueba el módulo real y no una copia. R$ 80/día con jornada de 8 h da
  exactamente R$ 10,00/hora; 80/3 da 2667 sin cola; un bono del 33 % da el mismo
  total por dos caminos.
- **`jerarquia.mjs`: 10 de 10.** Un admin recibe 403 al crear, editar, degradar,
  reiniciar la clave o eliminar a otro admin o al developer, y 400 al intentarlo
  consigo mismo. Tampoco puede promover a un mesero hasta administrador. El
  developer sí puede todo eso. Un mesero recibe 403 en los tres módulos nuevos.
- **`privacidad.mjs`: 8 de 8.** Ni `anon` ni un admin autenticado leen las tablas
  de personal por PostgREST; el admin las recibe solo por la Edge Function.
  `anon` sigue leyendo las redes pero no `horas_jornada`. `admin_code` no es
  legible desde el navegador por nadie.
- **`nomina.mjs`: 10 de 10.** Ajuste sin motivo, rechazado; sin código, 403 con
  `bad_code`; con código, registrado con quién y cuándo. Cerrar la semana y
  después subir el sueldo del empleado no la altera. Una semana cerrada no acepta
  más ajustes.
- **`ciclo-vida.mjs`: 9 de 9.** Retirar y reingresar conservan código e
  historial. Ninguna acción borra un legajo.
- **`marcaciones.mjs`: 7 de 7.** Reimportar el mismo archivo no duplica; el hash
  del bruto cubre los archivos sin identificador propio; la línea original queda
  guardada tal cual.

**54 pruebas, todas en verde.**

Un hallazgo del propio proceso: al limpiar los datos de prueba, el trigger de
`nomina_ajustes` frenó el `DELETE` en cascada de la semana **incluso viniendo de
`postgres` por SQL directo**, y revirtió la transacción entera. Hubo que
apagarlo y volver a encenderlo dentro de la misma transacción para poder borrar.
Es la mejor prueba de que la inmutabilidad no depende de la aplicación.

Los datos de prueba se borraron: la base quedó con los dos legajos reales
(EMP-001 Betsimar, EMP-002 Jonathan), sin marcaciones ni semanas de nómina, y con
tres cuentas —los dos admins y el developer—.

Falta la revisión a mano de la ficha impresa (que entre en una hoja) y de las
tablas apiladas en el teléfono, con `01 - Entradas/serve.ps1`, y subir el panel a
Netlify.

## Archivos tocados

- `supabase/migrations/20260812000015_personal.sql` (nuevo)
- `supabase/functions/_shared/dinero.ts` (nuevo), `_shared/supabase.ts`
- `supabase/functions/empleados/`, `nomina/` (nuevas)
- `supabase/functions/staff-admin/`, `operaciones/`, `courtesy-ticket/`,
  `solicitud-accion/`
- `supabase/config.toml`
- `01 - Entradas/admin/empleados.html`, `nomina.html`, `usuarios.html`,
  `ficha.html` (nuevos)
- `01 - Entradas/admin/js/empleados-lista.js`, `empleados.js`, `nomina.js`,
  `usuarios.js`, `ficha.js` (nuevos)
- `01 - Entradas/admin/js/admin.js`, `panel-base.js`
- `01 - Entradas/admin/css/admin.css`, `css/ficha.css` (nuevo)
- `verificacion/` (nueva carpeta: seis scripts, un SQL y el README)

## Lo que queda pendiente

- **Subir el panel a Netlify.** Las cuatro páginas nuevas están solo en local.
- La revisión a mano de la ficha impresa y de las tablas en el teléfono.
- El cálculo de horas desde las marcaciones, cuando se sepa el formato del
  captahuellas. La columna `nomina_lineas.horas_trabajadas` ya está.
- Las cédulas de Betsimar y Jonathan: sus legajos quedan cargados sin documento,
  que el formulario del panel sí exige. `empleados.documento` admite nulo por eso
  — inventar una cédula habría sido peor que dejarla vacía.
- **El primer ingreso de Betsimar sigue siendo suyo:** su cuenta nunca se usó y
  conserva `must_change_password`. La cuenta de desarrollo se creó aparte y con
  el mismo control activado.
- Eliminar o transferir la cuenta de desarrollo al entregar el proyecto.
