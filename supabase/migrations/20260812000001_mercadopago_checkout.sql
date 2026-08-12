-- Cambio de pasarela: Pagar.me -> Mercado Pago (cobro PIX por la API de Pagos).
--
-- El comprador no sale del sitio: Mercado Pago devuelve el QR y el código
-- "copia e cola", y la propia página los muestra. Las columnas pasan a nombres
-- neutrales para no quedar atadas al proveedor de turno.

alter table public.orders rename column pagarme_order_id to provider_ref;
alter table public.orders rename column pagarme_charge_id to provider_payment_id;
alter table public.orders rename column pix_expires_at to expires_at;
alter table public.orders rename column pix_qr_code_url to pix_qr_base64;

comment on column public.orders.provider_ref is
  'Identificador del cobro en la pasarela.';
comment on column public.orders.provider_payment_id is
  'Identificador del pago concreto en la pasarela.';
comment on column public.orders.pix_qr_code is
  'Código PIX "copia e cola" devuelto por la pasarela.';
comment on column public.orders.pix_qr_base64 is
  'Imagen PNG del QR en base64, para mostrarla sin salir del sitio.';

alter table public.webhook_events alter column provider set default 'mercadopago';

-- El precio lo edita el admin desde el panel y `create-order` lo lee de acá en
-- cada venta, así que conviene dejar registro de cuándo cambió.
alter table public.sections add column if not exists price_updated_at timestamptz;

create or replace function public.touch_price_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.price_cents is distinct from old.price_cents then
    new.price_updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sections_price_updated on public.sections;
create trigger trg_sections_price_updated
  before update of price_cents on public.sections
  for each row execute function public.touch_price_updated_at();
