# 2026-09-26 · PDF del plano de mesas y el voseo que quedaba

Día del evento (Jorge Guerrero en vivo).

## PDF del plano de mesas y sillas

Pedido: dejar en la raíz del proyecto un PDF con los planos de las sillas.

`Plano de mesas y sillas.pdf` en `C:\Users\enrri\Documents\Apps\En prokart\`.
Una hoja A4 horizontal con la misma disposición que ve quien compra: tarima,
Sección A y B al frente con la pasarela en el medio, Sección C al fondo con
U1–U3 en dorado y VIP Plata detrás. Cada mesa con su código y sus sillas.

- Datos reales de `tables_public` (141 mesas · 672 sillas).
- Las tomadas salen rayadas, con la fecha y la hora en la cabecera para que no
  se confunda con el estado de más tarde (al generarlo: 28 mesas, 160 sillas).
- El Área General queda anotada como sección sin mesas.

Cómo se rehace: se baja `tables_public` a un JSON, un script arma la hoja HTML
(mismo agrupado que `js/app.js` → `pintarPlano()`: la inicial del código manda,
y las U caen en la C por su `pos_x`) y `agent-browser pdf` la imprime. El script
quedó en el scratchpad de la sesión, no en el repo: si hace falta de nuevo, se
vuelve a escribir en un rato.

## Todo el idioma en tuteo

El 13/08 se pasó el sitio a español latino, pero habían quedado ocho textos en
voseo. Buscados con un barrido de imperativos de vos (raíz + á/é/í, formas con
pronombre pegado tipo «Elegilo» y presentes tipo «tenés»), sobre la web, el
panel y las Edge Functions:

| Dónde | Antes | Ahora |
|---|---|---|
| `pagar.html` | Pagá con PIX | Paga con PIX |
| `pagar.html` | Escaneá el código… | Escanea el código… |
| `pagar.html` | O copiá el código PIX | O copia el código PIX |
| `js/pagar.js` | Presentá este QR… | Presenta este QR… |
| `js/pagar.js` | Elegilo de nuevo | Elígelo de nuevo |
| `js/solicitud.js` | Adjuntá tu currículum | Adjunta tu currículum |
| `admin/index.html` | Cambiá tu contraseña | Cambia tu contraseña |
| `admin/js/admin.js` | Combiná letras y números | Combina letras y números |

Los correos y los mensajes del bot ya estaban en tuteo. «Olvidé mi contraseña»
se deja: es primera persona, no voseo.

Publicado con `./desplegar.sh` y comprobado en enprokart.com: las ocho frases
nuevas se sirven en los archivos sellados con `?v=`.
