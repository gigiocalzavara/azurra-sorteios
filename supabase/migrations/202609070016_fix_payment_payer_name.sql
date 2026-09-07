-- Corrige a ambiguidade entre o parâmetro payer_name e a coluna orders.payer_name.

create or replace function public.report_public_payment(
  order_token uuid,
  participant_phone text,
  payer_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text;
  target_order public.orders%rowtype;
begin
  normalized_phone := regexp_replace(coalesce(participant_phone, ''), '[^0-9+]', '', 'g');

  select ord.* into target_order
  from public.orders ord
  join public.participants part on part.id = ord.participant_id
  where ord.public_token = order_token
    and part.phone_e164 = normalized_phone
  for update of ord;

  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido não encontrado.';
  end if;

  perform public.release_expired_reservations(target_order.promotion_id);

  select ord.* into target_order
  from public.orders ord
  where ord.id = target_order.id;

  if target_order.status = 'expired' then
    raise exception using errcode = '55000', message = 'Esta reserva expirou.';
  end if;

  if target_order.status not in ('pending', 'payment_reported') then
    raise exception using errcode = '55000', message = 'O pagamento deste pedido não pode ser informado.';
  end if;

  update public.orders as ord
     set status = 'payment_reported',
         payer_name = nullif(btrim($3), ''),
         payment_reported_at = coalesce(ord.payment_reported_at, now()),
         updated_at = now()
   where ord.id = target_order.id;

  return jsonb_build_object(
    'order_id', target_order.id,
    'status', 'payment_reported'
  );
end;
$$;

revoke all on function public.report_public_payment(uuid, text, text) from public;
grant execute on function public.report_public_payment(uuid, text, text) to anon, authenticated;
