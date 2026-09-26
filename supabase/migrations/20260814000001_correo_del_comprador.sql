-- El correo del comprador se guarda, y el documento y el teléfono pueden faltar.
--
-- Dos cambios que van juntos porque son la misma idea: qué datos de contacto
-- exige una compra y cuáles no.
--
-- El correo. Hasta ahora se pedía en el formulario, se le pasaba a la pasarela
-- y ahí moría: no quedaba en ninguna fila. Es el único dato con el que se le
-- puede mandar a alguien su código de entrada, así que ahora se guarda.
--
-- El documento y el WhatsApp dejan de ser obligatorios en la base. Lo eran, y
-- por eso una cortesía del panel —donde no se le pide el documento a un
-- invitado— se guardaba con la cédula literal 'CORTESIA' y el teléfono '-'.
-- Eso no es un dato faltante: es un dato inventado, que después se imprime en
-- la entrada y se puede buscar en Operaciones como si fuera cierto. Vacío es
-- vacío, y la pantalla ya sabe mostrar un guion cuando no hay nada.
--
-- Las filas viejas no se tocan: las que ya dicen 'CORTESIA' siguen diciéndolo.
-- Reescribir entradas emitidas para que se vean mejor es cambiar el registro
-- de lo que pasó.

alter table public.orders
  add column if not exists buyer_email text;

comment on column public.orders.buyer_email is
  'Correo del comprador. Es por donde le llega su código de entrada, y por eso
   se pide en el sitio; en una cortesía del panel puede quedar vacío.';

alter table public.orders  alter column buyer_document drop not null;
alter table public.orders  alter column buyer_whatsapp drop not null;
alter table public.tickets alter column buyer_document drop not null;
alter table public.tickets alter column buyer_whatsapp drop not null;
