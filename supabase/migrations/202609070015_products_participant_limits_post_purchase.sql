-- Produtos, limite acumulado por participante, campanha com multiplos produtos,
-- resumo de cotas esgotadas e fluxo de pos-compra do vencedor.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null,
  image_url text,
  price numeric(12,2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promotion_products (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  display_order integer not null default 0,
  primary key (promotion_id, product_id)
);

alter table public.promotions
  add column if not exists campaign_image_url text,
  add column if not exists maximum_per_participant integer check (maximum_per_participant is null or maximum_per_participant > 0),
  add column if not exists post_draw_pix_amount numeric(12,2) check (post_draw_pix_amount is null or post_draw_pix_amount >= 0);

create type public.post_purchase_stage as enum ('pending_send','awaiting_product','awaiting_reward_type','awaiting_address','completed','failed');

create table public.post_purchase_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  draw_id uuid not null unique references public.draws(id) on delete cascade,
  phone_e164 text not null,
  stage public.post_purchase_stage not null default 'pending_send',
  selected_product_id uuid references public.products(id) on delete set null,
  reward_type text check (reward_type is null or reward_type in ('pix','product')),
  delivery_address text,
  last_message_id text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_org_active_idx on public.products(organization_id, active);
create index if not exists promotion_products_promotion_idx on public.promotion_products(promotion_id, display_order);
create index if not exists post_purchase_flows_queue_idx on public.post_purchase_flows(stage, created_at);
create index if not exists post_purchase_flows_phone_idx on public.post_purchase_flows(organization_id, phone_e164, stage);

alter table public.products enable row level security;
alter table public.promotion_products enable row level security;
alter table public.post_purchase_flows enable row level security;

create policy "members manage products" on public.products for all to authenticated
using (public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager'))
with check (public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager'));

create policy "members manage promotion products" on public.promotion_products for all to authenticated
using (exists(select 1 from public.promotions p where p.id=promotion_id and (public.is_superadmin() or public.member_role(p.organization_id) in ('superadmin','admin','manager'))))
with check (exists(select 1 from public.promotions p where p.id=promotion_id and (public.is_superadmin() or public.member_role(p.organization_id) in ('superadmin','admin','manager'))));

create policy "members read post purchase flows" on public.post_purchase_flows for select to authenticated
using (public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager','operator'));

create trigger products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger post_purchase_flows_updated_at before update on public.post_purchase_flows
for each row execute function public.set_updated_at();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create policy "members upload product images" on storage.objects for insert to authenticated
with check(bucket_id='product-images');
create policy "members update product images" on storage.objects for update to authenticated
using(bucket_id='product-images') with check(bucket_id='product-images');
create policy "public read product images" on storage.objects for select to public
using(bucket_id='product-images');

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
    'campaign_image_url', coalesce(p.campaign_image_url,p.product_image_url),
    'product_image_url', p.product_image_url,
    'quota_quantity', p.quota_quantity,
    'quota_price', p.quota_price,
    'minimum_per_order', p.minimum_per_order,
    'maximum_per_order', p.maximum_per_order,
    'maximum_per_participant', p.maximum_per_participant,
    'post_draw_pix_amount', p.post_draw_pix_amount,
    'reservation_minutes', p.reservation_minutes,
    'status', p.status,
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'description', pr.description,
        'image_url', pr.image_url,
        'price', pr.price
      ) order by pp.display_order,pr.name)
      from public.promotion_products pp
      join public.products pr on pr.id=pp.product_id
      where pp.promotion_id=p.id and pr.active=true
    ),'[]'::jsonb),
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
      'available', (select count(*) from public.quotas q where q.promotion_id=p.id and q.status='available'),
      'reserved', (select count(*) from public.quotas q where q.promotion_id=p.id and q.status='reserved'),
      'paid', (select count(*) from public.quotas q where q.promotion_id=p.id and q.status='paid')
    )
  )
  from public.promotions p
  join public.organizations o on o.id=p.organization_id
  where o.slug=organization_slug
    and p.slug=promotion_slug
    and o.active=true
    and p.status in ('published','sold_out','ready_to_draw','drawn')
  limit 1;
$$;

create or replace function public.create_public_order(
  organization_slug text,
  promotion_slug text,
  participant_name text,
  participant_phone text,
  participant_phone_confirmation text,
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
  normalized_confirmation text;
  available_count integer;
  participant_existing_count integer;
begin
  normalized_name := btrim(participant_name);
  normalized_phone := regexp_replace(coalesce(participant_phone,''),'[^0-9+]','','g');
  normalized_confirmation := regexp_replace(coalesce(participant_phone_confirmation,''),'[^0-9+]','','g');

  if char_length(normalized_name)<2 or char_length(normalized_name)>120 then
    raise exception using errcode='22023',message='Informe um nome válido.';
  end if;
  if normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode='22023',message='Informe um WhatsApp válido.';
  end if;
  if normalized_confirmation<>normalized_phone then
    raise exception using errcode='22023',message='Os números de WhatsApp informados não são iguais.';
  end if;

  select o.* into selected_organization from public.organizations o
  where o.slug=organization_slug and o.active=true limit 1;
  if not found then raise exception using errcode='P0002',message='Organização não encontrada.'; end if;

  select p.* into selected_promotion from public.promotions p
  where p.organization_id=selected_organization.id and p.slug=promotion_slug for update;
  if not found then raise exception using errcode='P0002',message='Promoção não encontrada.'; end if;
  if selected_promotion.status<>'published' then raise exception using errcode='55000',message='Esta promoção não está recebendo novas reservas.'; end if;

  if requested_quota_count is null or requested_quota_count<selected_promotion.minimum_per_order
    or (selected_promotion.maximum_per_order is not null and requested_quota_count>selected_promotion.maximum_per_order) then
    raise exception using errcode='22023',message='Quantidade de cotas inválida.';
  end if;

  perform public.release_expired_reservations(selected_promotion.id);

  if selected_promotion.maximum_per_participant is not null then
    select coalesce(sum(ord.quota_count),0)::integer into participant_existing_count
    from public.orders ord
    join public.participants part on part.id=ord.participant_id
    where ord.promotion_id=selected_promotion.id
      and part.phone_e164=normalized_phone
      and ord.status in ('pending','payment_reported','paid');
    if participant_existing_count+requested_quota_count>selected_promotion.maximum_per_participant then
      raise exception using errcode='22023',message=format('Limite de %s cotas por participante nesta promoção.',selected_promotion.maximum_per_participant);
    end if;
  end if;

  select count(*)::integer into available_count from public.quotas q
  where q.promotion_id=selected_promotion.id and q.status='available';
  if available_count<requested_quota_count then
    raise exception using errcode='P0001',message=format('Restam apenas %s cotas disponíveis.',available_count);
  end if;

  insert into public.participants(organization_id,name,phone_e164,consent_at)
  values(selected_organization.id,normalized_name,normalized_phone,now())
  on conflict(organization_id,phone_e164) do update set name=excluded.name,consent_at=coalesce(public.participants.consent_at,excluded.consent_at),updated_at=now()
  returning id into selected_participant_id;

  insert into public.orders(promotion_id,participant_id,quota_count,unit_price,reservation_expires_at)
  values(selected_promotion.id,selected_participant_id,requested_quota_count,selected_promotion.quota_price,now()+make_interval(mins=>selected_promotion.reservation_minutes))
  returning id,public_token into new_order_id,new_public_token;

  with selected_quotas as (
    select q.id from public.quotas q where q.promotion_id=selected_promotion.id and q.status='available'
    order by random() for update skip locked limit requested_quota_count
  ), reserved_quotas as (
    update public.quotas q set status='reserved',order_id=new_order_id,reserved_at=now()
    where q.id in(select id from selected_quotas) returning q.number
  ) select array_agg(number order by number) into selected_numbers from reserved_quotas;

  if coalesce(array_length(selected_numbers,1),0)<>requested_quota_count then
    raise exception using errcode='40001',message='As cotas foram reservadas por outra pessoa. Tente novamente.';
  end if;

  insert into public.audit_events(organization_id,event_type,entity_type,entity_id,payload)
  values(selected_organization.id,'public_order_created','order',new_order_id,jsonb_build_object('promotion_id',selected_promotion.id,'quota_count',requested_quota_count));

  return jsonb_build_object('order_id',new_order_id,'public_token',new_public_token,'status','pending','quota_count',requested_quota_count,'unit_price',selected_promotion.quota_price,'total_amount',requested_quota_count*selected_promotion.quota_price,'reservation_expires_at',now()+make_interval(mins=>selected_promotion.reservation_minutes));
end;
$$;

create or replace function public.sold_out_allocation_text(target_promotion_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(string_agg(format('%s — %s',part.name,string_agg_quota.numbers),E'\n' order by part.name),'')
  from (
    select ord.participant_id,string_agg(q.number::text,', ' order by q.number) numbers
    from public.orders ord
    join public.quotas q on q.order_id=ord.id and q.status='paid'
    where ord.promotion_id=target_promotion_id and ord.status='paid'
    group by ord.participant_id
  ) string_agg_quota
  join public.participants part on part.id=string_agg_quota.participant_id;
$$;

create or replace function public.promotion_communication_trigger() returns trigger language plpgsql security definer set search_path=public as $$
declare d public.draws%rowtype;q integer;w text;allocation text;winner_participant uuid;winner_phone text;
begin
 if new.status='published' and old.status is distinct from new.status then perform public.enqueue_communication(new.id,'launch');end if;
 if new.status='ready_to_draw' and old.status is distinct from new.status then
  allocation:=public.sold_out_allocation_text(new.id);
  perform public.enqueue_communication(new.id,'sold_out',jsonb_build_object('allocation',allocation));
  update public.communication_events
    set rendered_message=rendered_message||E'\n\n📋 *Distribuição das cotas*\n'||allocation,
        payload=payload||jsonb_build_object('allocation',allocation),updated_at=now()
  where promotion_id=new.id and stage='sold_out';
 end if;
 if new.status='drawn' and old.status is distinct from new.status then
  select * into d from public.draws where promotion_id=new.id;
  select number into q from public.quotas where id=d.winning_quota_id;
  w:=d.participant_snapshot->>'name';
  winner_participant:=(d.participant_snapshot->>'id')::uuid;
  winner_phone:=d.participant_snapshot->>'phone';
  perform public.enqueue_communication(new.id,'result',jsonb_build_object('numero_vencedor',q,'vencedor',w,'media_url',d.video_url));
  insert into public.post_purchase_flows(organization_id,promotion_id,participant_id,draw_id,phone_e164)
  values(new.organization_id,new.id,winner_participant,d.id,winner_phone)
  on conflict(draw_id) do nothing;
 end if;
 return new;
end;$$;

revoke all on function public.create_public_order(text,text,text,text,text,integer) from public;
grant execute on function public.create_public_order(text,text,text,text,text,integer) to anon,authenticated;
grant execute on function public.get_public_promotion(text,text) to anon,authenticated;
