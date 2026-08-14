-- Plata deja de decir que la mesa se asigna por orden de llegada.
--
-- Dejó de ser cierto en 20260813000010: ahí Plata pasó a `manual` y su mapa se
-- empezó a mostrar. El aviso quedó escrito en la sección y siguió apareciendo
-- en el panel, contradiciendo al plano donde el comprador ya elige su mesa.
--
-- Se borra en vez de reescribirse: la sección no necesita explicar nada, el
-- plano se explica solo. `notice` sigue existiendo para General, que sí tiene
-- algo que aclarar —se entra de pie, sin mesa.

update public.sections s
   set notice = null
 where s.code = 'PLATA'
   and s.assignment_mode = 'manual'
   and s.notice is not null;
