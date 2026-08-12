# Spec · Mapa de mesas y venta por mesa

- Fecha: 2026-08-12
- Estado: aprobado, en construcción
- Maqueta aprobada: artifact "Plano Pro Kart"

## Qué cambia

Hasta ahora se vendía **una silla por compra** y el comprador elegía área →
mesa → silla. Pasa a venderse **por mesa**, sobre un plano fiel al salón.

## Distribución del salón

Fija: no cambia entre eventos. Lo que cambia por evento es el nombre, la fecha,
el lugar y la imagen de portada.

| Sección | Mesas | Sillas | Selección |
|---|---|---|---|
| A | 9 (A1–A9) | 6 c/u | el comprador elige en el mapa |
| B | 9 (B1–B9) | 6 c/u | el comprador elige en el mapa |
| C | 9 (C1–C9) | 6 c/u, salvo **C5 "Única"** con 8 | el comprador elige en el mapa |
| PLATA | sin mapa | sin lugar asignado | se paga y se llega temprano |
| GENERAL | sin mesas | de pie | sin límite |

C5 tiene precio propio, editable por el admin igual que el resto.

Las mesas se identifican por su código (`A1`, `C5`), y las sillas quedan como
`A1-1`, `A1-2`, …, `C5-8`.

## Reglas de venta

**Se cobra por mesa, no por persona.** El precio de la sección es el de una mesa
de 6. Si el grupo pasa de 6 hace falta otra mesa: 7 personas son 2 mesas, 13 son
3. Una persona sola paga una mesa entera, porque las mesas no se comparten.

**La mesa se vende completa.** Al comprarla quedan ocupadas sus 6 (u 8) sillas.
No hay selección de silla individual: simplifica el mapa y evita que un
desconocido se siente en la mesa de otro grupo.

**El comprador elige qué mesas quiere**, las que estén libres, no necesariamente
contiguas.

**Se emite una entrada por persona.** Un grupo de 8 con 2 mesas recibe 8 QR, uno
por invitado, cada uno con su mesa asignada. La validación en la puerta es
individual.

## Flujo del comprador

1. Entra al sitio, ve la portada del evento y el plano.
2. Toca una mesa → **modal**: "¿Cuántas personas son?" con +/− y Continuar.
3. Elige las mesas que necesite; la barra le avisa si le faltan.
4. Toca Continuar → pasa a `pagar.html` con sus datos y el QR de PIX.

El modal aparece al primer toque, no antes: en el celular la pantalla es lo
escaso y preguntar de entrada agrega un paso a quien todavía no decidió nada.

## Portada del evento

Debajo del hero, la imagen del evento con nombre, fecha y lugar superpuestos.
Los tres son campos del evento en la base, editables desde el panel. Al abrir un
evento nuevo se cargan los suyos y el plano queda igual.

La foto original pesaba 2,3 MB; se sirve una versión de 223 KB.

## Decisiones de diseño del plano

**La tarima domina.** En la primera maqueta parecía más chica que las mesas.
Ahora lleva estructura de truss, focos y haces de luz que caen al piso: es el
punto de referencia para entender dónde queda cada mesa.

**Plata es un bloque, no mesas falsas.** Dibujar mesas que no se pueden elegir
promete algo que no existe. El aviso de "orden de llegada" aparece solo cuando
alguien la selecciona.

**Las mesas ocupadas llevan trama diagonal además del rojo**, para que el estado
no dependa solo del color.

## Pendiente de definir

Una persona sola paga la mesa completa. Queda así salvo que se decida ofrecerle
Plata como alternativa.
