-- Una sección se puede sacar de la venta sin borrarla.
--
-- Hasta ahora, para no vender la Sección B había que borrar sus mesas: se
-- perdía la distribución del salón y había que rearmarla para el evento
-- siguiente. Con esto se apaga y se enciende, y el salón queda como está.
--
-- Apagada significa una sola cosa: no se ofrece en el sitio. No aparece su
-- tarjeta, no se dibujan sus mesas y `create-order` la rechaza si alguien
-- llega igual con el código en la mano. Lo que ya se vendió sigue valiendo
-- —apagar una sección no cancela entradas— y las cortesías del panel se
-- siguen pudiendo sentar ahí: el que las emite sabe lo que hace.

alter table public.sections
  add column if not exists on_sale boolean not null default true;

comment on column public.sections.on_sale is
  'false = la sección no se ofrece en el sitio ni se puede comprar. No afecta a
   las entradas ya emitidas ni a las cortesías del panel.';
