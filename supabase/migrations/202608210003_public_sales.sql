-- Azurra Sorteios: fluxo público de vendas
-- Requer as migrations 202608210001_foundation.sql e 202608210002_storage.sql.
-- Pode ser executada uma única vez no SQL Editor do Supabase.

alter table public.orders
  add column public_token uuid not null default gen_random_uuid();

alter table public.orders
  add constraint orders_public_token_key unique (public_token);

create index orders_public_token_idx on public.orders(public_token);

create or replace function public.release_expired_reservations(
  target_promotion_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  with expired_orders as (
    update public.orders o
       set status = 'expired',
           updated_at = now()
     where o.status = 'pending'
       and o.reservation_expires_at <= now()
       and (target_promotion_id is null or o.promotion_id = target_promotion_id)
    returning o.id
  ),
  released_quotas as (
    update public.quotas q
       set status = 'available',
           order_id = null,
           reserved_at = null
     where q.status = 'reserved'
       and q.order_id in (select id from expired_orders)
    returning q.id
  )
  select count(*)::integer into released_count
  from released_quotas;

  return released_count;
end;
$$;

create or replace function public.get_public_promotion(
  organization_slug text,
  promotion_slug text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'slug', p.slug,
    'description', p.description,
    'special_condition', p.special_condition,
    'product_image_url', p.product_image_url,
    'quota_quantity', p.quota_quantity,
    'quota_price', p.quota_price,
    'minimum_per_order', p.minimum_per_order,
    'maximum_per_order', p.maximum_per_order,
    'reservation_minutes', p.reservation_minutes,
    'status', p.status,
    'organization', jsonb_build_object(
      'name', o.name,
      'slug', o.slug,
      'logo_url', o.logo_url,
      'primary_color', o.primary_color,
      'secondary_color', o.secondary_color
    ),
    'pix', jsonb_build_object(
      'key', o.pix_key,
      'key_type', o.pix_key_type,
      'receiver_name', o.pix_receiver_name,
      'receiver_city', o.pix_receiver_city
    ),
    'quotas', jsonb_build_object(
      'available', (
        select count(*)
        from public.quotas q
        where q.promotion_id = p.id
          and q.status = 'available'
      ),
      'reserved', (
        select count(*)
        from public.quotas q
        where q.promotion_id = p.id
          and q.status = 'reserved'
      ),
      'paid', (
        select count(*)
        from public.quotas q
        where q.promotion_id = p.id
          and q.status = 'paid'
      )
    )
  )
  from public.promotions p
  join public.organizations o on o.id = p.organization_id
  where o.slug = organization_slug
    and p.slug = promotion_slug
    and o.active = true
    and p.status in ('published', 'sold_out', 'ready_to_draw', 'drawn')
  limit 1;
$$;

create or replace function public.create_public_order(
  organization_slug text,
  promotion_slug text,
  participant_name text,
  participant_phone text,
  requested_quota_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_promotion public.promotions%rowtype;
  selected_organization public.organizations%rowtype;
  selected_participant_id uuid;
  new_order_id uuid;
  new_public_token uuid;
  selected_numbers integer[];
  normalized_name text;
  normalized_phone text;
  available_count integer;
begin
  normalized_name := btrim(participant_name);
  normalized_phone := regexp_replace(coalesce(participant_phone, ''), '[^0-9+]', '', 'g');

  if char_length(normalized_name) < 2 or char_length(normalized_name) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Informe um nome válido.';
  end if;

  if normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using
      errcode = '22023',
      message = 'Informe o telefone no formato internacional, por exemplo +5583999999999.';
  end if;

  select o.* into selected_organization
  from public.organizations o
  where o.slug = organization_slug
    and o.active = true
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'Organização não encontrada.';
  end if;

  select p.* into selected_promotion
  from public.promotions p
  where p.organization_id = selected_organization.id
    and p.slug = promotion_slug
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Promoção não encontrada.';
  end if;

  if selected_promotion.status <> 'published' then
    raise exception using errcode = '55000', message = 'Esta promoção não está recebendo novas reservas.';
  end if;

  if requested_quota_count is null
     or requested_quota_count < selected_promotion.minimum_per_order
     or (
       selected_promotion.maximum_per_order is not null
       and requested_quota_count > selected_promotion.maximum_per_order
     ) then
    raise exception using errcode = '22023', message = 'Quantidade de cotas inválida.';
  end if;

  perform public.release_expired_reservations(selected_promotion.id);

  select count(*)::integer into available_count
  from public.quotas q
  where q.promotion_id = selected_promotion.id
    and q.status = 'available';

  if available_count < requested_quota_count then
    raise exception using
      errcode = 'P0001',
      message = format('Restam apenas %s cotas disponíveis.', available_count);
  end if;

  insert into public.participants (
    organization_id,
    name,
    phone_e164,
    consent_at
  )
  values (
    selected_organization.id,
    normalized_name,
    normalized_phone,
    now()
  )
  on conflict (organization_id, phone_e164)
  do update set
    name = excluded.name,
    consent_at = coalesce(public.participants.consent_at, excluded.consent_at),
    updated_at = now()
  returning id into selected_participant_id;

  insert into public.orders (
    promotion_id,
    participant_id,
    quota_count,
    unit_price,
    reservation_expires_at
  )
  values (
    selected_promotion.id,
    selected_participant_id,
    requested_quota_count,
    selected_promotion.quota_price,
    now() + make_interval(mins => selected_promotion.reservation_minutes)
  )
  returning id, public_token into new_order_id, new_public_token;

  with selected_quotas as (
    select q.id
    from public.quotas q
    where q.promotion_id = selected_promotion.id
      and q.status = 'available'
    order by random()
    for update skip locked
    limit requested_quota_count
  ),
  reserved_quotas as (
    update public.quotas q
       set status = 'reserved',
           order_id = new_order_id,
           reserved_at = now()
     where q.id in (select id from selected_quotas)
    returning q.number
  )
  select array_agg(number order by number)
    into selected_numbers
  from reserved_quotas;

  if coalesce(array_length(selected_numbers, 1), 0) <> requested_quota_count then
    raise exception using
      errcode = '40001',
      message = 'As cotas foram reservadas por outra pessoa. Tente novamente.';
  end if;

  insert into public.audit_events (
    organization_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    selected_organization.id,
    'public_order_created',
    'order',
    new_order_id,
    jsonb_build_object(
      'promotion_id', selected_promotion.id,
      'quota_count', requested_quota_count
    )
  );

  return jsonb_build_object(
    'order_id', new_order_id,
    'public_token', new_public_token,
    'status', 'pending',
    'quota_numbers', to_jsonb(selected_numbers),
    'quota_count', requested_quota_count,
    'unit_price', selected_promotion.quota_price,
    'total_amount', requested_quota_count * selected_promotion.quota_price,
    'reservation_expires_at', now() + make_interval(mins => selected_promotion.reservation_minutes),
    'pix', jsonb_build_object(
      'key', selected_organization.pix_key,
      'key_type', selected_organization.pix_key_type,
      'receiver_name', selected_organization.pix_receiver_name,
      'receiver_city', selected_organization.pix_receiver_city
    )
  );
end;
$$;

create or replace function public.get_public_order(
  order_token uuid,
  participant_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text;
  target_order_id uuid;
  target_promotion_id uuid;
begin
  normalized_phone := regexp_replace(coalesce(participant_phone, ''), '[^0-9+]', '', 'g');

  select ord.id, ord.promotion_id
    into target_order_id, target_promotion_id
  from public.orders ord
  join public.participants part on part.id = ord.participant_id
  where ord.public_token = order_token
    and part.phone_e164 = normalized_phone
  limit 1;

  if not found then
    return null;
  end if;

  perform public.release_expired_reservations(target_promotion_id);

  return (
    select jsonb_build_object(
      'order_id', ord.id,
      'status', ord.status,
      'quota_numbers', coalesce(
        (
          select jsonb_agg(q.number order by q.number)
          from public.quotas q
          where q.order_id = ord.id
        ),
        '[]'::jsonb
      ),
      'quota_count', ord.quota_count,
      'unit_price', ord.unit_price,
      'total_amount', ord.total_amount,
      'reservation_expires_at', ord.reservation_expires_at,
      'payment_reported_at', ord.payment_reported_at,
      'paid_at', ord.paid_at,
      'promotion', jsonb_build_object(
        'name', promo.name,
        'slug', promo.slug
      ),
      'pix', jsonb_build_object(
        'key', org.pix_key,
        'key_type', org.pix_key_type,
        'receiver_name', org.pix_receiver_name,
        'receiver_city', org.pix_receiver_city
      )
    )
    from public.orders ord
    join public.promotions promo on promo.id = ord.promotion_id
    join public.organizations org on org.id = promo.organization_id
    where ord.id = target_order_id
  );
end;
$$;

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

  update public.orders
     set status = 'payment_reported',
         payer_name = nullif(btrim(payer_name), ''),
         payment_reported_at = coalesce(payment_reported_at, now()),
         updated_at = now()
   where id = target_order.id;

  return jsonb_build_object(
    'order_id', target_order.id,
    'status', 'payment_reported'
  );
end;
$$;

revoke all on function public.release_expired_reservations(uuid) from public;
revoke all on function public.get_public_promotion(text, text) from public;
revoke all on function public.create_public_order(text, text, text, text, integer) from public;
revoke all on function public.get_public_order(uuid, text) from public;
revoke all on function public.report_public_payment(uuid, text, text) from public;

grant execute on function public.release_expired_reservations(uuid) to authenticated;
grant execute on function public.get_public_promotion(text, text) to anon, authenticated;
grant execute on function public.create_public_order(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.get_public_order(uuid, text) to anon, authenticated;
grant execute on function public.report_public_payment(uuid, text, text) to anon, authenticated;
