-- Deja constancia de qué cobranzas de Asaas ya se apagaron.
--
-- El QR de Asaas no vence en minutos: vive hasta doce meses. La reserva de la
-- mesa dura cinco. Si solo soltáramos la mesa, el QR viejo seguiría cobrando y
-- alguien podría pagar una mesa ya revendida.
--
-- Cancelar la cobranza es lo que cierra esa puerta, pero no puede hacerlo el
-- cron: pg_cron corre SQL puro y pg_net no está habilitado en este proyecto,
-- así que desde la base no hay forma de llamar a Asaas.
--
-- Lo hace `create-order`, barriendo las vencidas antes de tomar una mesa. No es
-- un rodeo: el peligro solo existe cuando una mesa se revende, y una mesa solo
-- se revende por ahí. Esta columna es lo que evita cancelar dos veces lo mismo.

alter table public.orders
  add column if not exists charge_canceled_at timestamptz;

comment on column public.orders.charge_canceled_at is
  'Cuándo se apagó la cobranza en la pasarela tras vencer la reserva. Null = sigue viva o nunca hubo.';

-- Solo interesan las que quedaron con una cobranza viva y sin apagar.
create index if not exists idx_orders_cobranza_por_apagar
  on public.orders (status)
  where provider_payment_id is not null and charge_canceled_at is null;

-- El diagnóstico ya cumplió su función.
drop table if exists public.diag_cron;
