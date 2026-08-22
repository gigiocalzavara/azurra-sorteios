-- Venda pública: leitura da identidade/PIX e reserva atômica de cotas.

create policy "public reads organizations with active promotions" on public.organizations
for select using (
  active and exists (
    select 1 from public.promotions p
    where p.organization_id = id
      and p.status in ('published', 'sold_out', 'ready_to_draw', 'drawn')
  )
);

create policy "public reads quotas from public promotions" on public.quotas
for select using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id
      and p.status in ('published', 'sold_out', 'ready_to_draw', 'drawn')
  )
);

create or replace function public.reserve_random_quotas(
  target_promotion uuid,
  participant_name text,
  participant_phone text,
  requested_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_promotion public.promotions%rowtype;
  selected_participant_id uuid;
  selected_order_id uuid;
  selected_numbers integer[];
  normalized_name text := nullif(trim(participant_name), '');
  normalized_phone text := regexp_replace(coalesce(participant_phone, ''), '[^0-9]', '', 'g');
begin
  select * into selected_promotion
  from public.promotions
  where id = target_promotion
  for update;

  if not found or selected_promotion.status <> 'published' then
    raise exception 'PROMOTION_UNAVAILABLE';
  end if;

  if normalized_name is null or char_length(normalized_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;

  if char_length(normalized_phone) not between 10 and 13 then
    raise exception 'INVALID_PHONE';
  end if;

  if requested_count < selected_promotion.minimum_per_order
    or (selected_promotion.maximum_per_order is not null and requested_count > selected_promotion.maximum_per_order)
  then
    raise exception 'INVALID_QUOTA_COUNT';
  end if;

  select array_agg(number order by number) into selected_numbers
  from (
    select number
    from public.quotas
    where promotion_id = target_promotion and status = 'available'
    order by random()
    limit requested_count
    for update skip locked
  ) available;

  if coalesce(array_length(selected_numbers, 1), 0) <> requested_count then
    raise exception 'NOT_ENOUGH_QUOTAS';
  end if;

  insert into public.participants (organization_id, name, phone_e164, consent_at)
  values (selected_promotion.organization_id, normalized_name, normalized_phone, now())
  on conflict (organization_id, phone_e164)
  do update set name = excluded.name, updated_at = now()
  returning id into selected_participant_id;

  insert into public.orders (
    promotion_id, participant_id, quota_count, unit_price, reservation_expires_at
  ) values (
    target_promotion,
    selected_participant_id,
    requested_count,
    selected_promotion.quota_price,
    now() + make_interval(mins => selected_promotion.reservation_minutes)
  ) returning id into selected_order_id;

  update public.quotas
  set status = 'reserved', order_id = selected_order_id, reserved_at = now()
  where promotion_id = target_promotion and number = any(selected_numbers);

  return jsonb_build_object(
    'order_id', selected_order_id,
    'numbers', selected_numbers,
    'quota_count', requested_count,
    'total_amount', requested_count * selected_promotion.quota_price,
    'expires_at', now() + make_interval(mins => selected_promotion.reservation_minutes)
  );
end;
$$;

revoke all on function public.reserve_random_quotas(uuid, text, text, integer) from public;
grant execute on function public.reserve_random_quotas(uuid, text, text, integer) to anon, authenticated;
