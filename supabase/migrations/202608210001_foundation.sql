-- Azurra Sorteios: banco inicial
-- Execute uma única vez em um projeto Supabase vazio.

create extension if not exists pgcrypto;

create type public.app_role as enum ('superadmin', 'admin', 'manager', 'operator');
create type public.promotion_status as enum ('draft', 'published', 'sold_out', 'ready_to_draw', 'drawn', 'cancelled');
create type public.order_status as enum ('pending', 'payment_reported', 'paid', 'expired', 'cancelled', 'payment_conflict');
create type public.quota_status as enum ('available', 'reserved', 'paid', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  logo_url text,
  primary_color text not null default '#6900ff',
  secondary_color text not null default '#00f0ff',
  pix_key text,
  pix_key_type text,
  pix_receiver_name text,
  pix_receiver_city text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'operator',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null,
  special_condition text,
  product_image_url text,
  quota_quantity integer not null check (quota_quantity between 1 and 100000),
  quota_price numeric(12,2) not null check (quota_price > 0),
  minimum_per_order integer not null default 1 check (minimum_per_order > 0),
  maximum_per_order integer check (maximum_per_order is null or maximum_per_order > 0),
  reservation_minutes integer not null default 30 check (reservation_minutes between 5 and 1440),
  status public.promotion_status not null default 'draft',
  published_at timestamptz,
  sold_out_at timestamptz,
  drawn_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone_e164 text not null,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  status public.order_status not null default 'pending',
  quota_count integer not null check (quota_count > 0),
  unit_price numeric(12,2) not null check (unit_price > 0),
  total_amount numeric(12,2) generated always as (quota_count * unit_price) stored,
  payer_name text,
  payment_proof_url text,
  payment_reported_at timestamptz,
  paid_at timestamptz,
  reservation_expires_at timestamptz not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotas (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  number integer not null check (number > 0),
  status public.quota_status not null default 'available',
  order_id uuid references public.orders(id) on delete set null,
  reserved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (promotion_id, number)
);

create table public.draws (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null unique references public.promotions(id) on delete restrict,
  winning_quota_id uuid not null unique references public.quotas(id) on delete restrict,
  participant_snapshot jsonb not null,
  quotas_snapshot_hash text not null,
  draw_seed_hash text not null,
  drawn_by uuid references auth.users(id) on delete set null,
  drawn_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index promotions_org_status_idx on public.promotions(organization_id, status);
create index orders_promotion_status_idx on public.orders(promotion_id, status);
create index quotas_promotion_status_idx on public.quotas(promotion_id, status);
create index quotas_order_idx on public.quotas(order_id);
create index participants_org_phone_idx on public.participants(organization_id, phone_e164);
create index audit_org_created_idx on public.audit_events(organization_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger promotions_updated_at before update on public.promotions
for each row execute function public.set_updated_at();
create trigger participants_updated_at before update on public.participants
for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.member_role(target_org uuid)
returns public.app_role language sql stable security definer set search_path = public
as $$
  select role from public.organization_members
  where organization_id = target_org and user_id = auth.uid();
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_superadmin() or exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function public.generate_promotion_quotas()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.quotas (promotion_id, number)
  select new.id, n from generate_series(1, new.quota_quantity) as n;
  return new;
end;
$$;

create trigger generate_quotas_after_promotion
after insert on public.promotions
for each row execute function public.generate_promotion_quotas();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.promotions enable row level security;
alter table public.participants enable row level security;
alter table public.orders enable row level security;
alter table public.quotas enable row level security;
alter table public.draws enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles own read" on public.profiles
for select using (id = auth.uid() or public.is_superadmin());
create policy "superadmin manages profiles" on public.profiles
for all using (public.is_superadmin()) with check (public.is_superadmin());

create policy "members read organizations" on public.organizations
for select using (public.is_org_member(id));
create policy "superadmin creates organizations" on public.organizations
for insert with check (public.is_superadmin());
create policy "superadmin updates organizations" on public.organizations
for update using (public.is_superadmin()) with check (public.is_superadmin());
create policy "superadmin deletes organizations" on public.organizations
for delete using (public.is_superadmin());

create policy "members read memberships" on public.organization_members
for select using (public.is_org_member(organization_id));
create policy "admins manage memberships" on public.organization_members
for all
using (
  public.is_superadmin()
  or public.member_role(organization_id) in ('superadmin', 'admin')
)
with check (
  public.is_superadmin()
  or public.member_role(organization_id) in ('superadmin', 'admin')
);

create policy "public reads published promotions" on public.promotions
for select using (status in ('published', 'sold_out', 'ready_to_draw', 'drawn'));
create policy "members create promotions" on public.promotions
for insert with check (
  public.is_superadmin()
  or public.member_role(organization_id) in ('superadmin', 'admin', 'manager')
);
create policy "members update promotions" on public.promotions
for update
using (
  public.is_superadmin()
  or public.member_role(organization_id) in ('superadmin', 'admin', 'manager')
)
with check (
  public.is_superadmin()
  or public.member_role(organization_id) in ('superadmin', 'admin', 'manager')
);
create policy "admins delete promotions" on public.promotions
for delete using (
  public.is_superadmin()
  or public.member_role(organization_id) in ('superadmin', 'admin')
);

create policy "members read participants" on public.participants
for select using (public.is_org_member(organization_id));
create policy "members manage participants" on public.participants
for all
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members read orders" on public.orders
for select using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
);
create policy "members manage orders" on public.orders
for all
using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
)
with check (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
);

create policy "members read quotas" on public.quotas
for select using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
);
create policy "members manage quotas" on public.quotas
for all
using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
)
with check (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
);

create policy "members read draws" on public.draws
for select using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id and public.is_org_member(p.organization_id)
  )
);
create policy "admins manage draws" on public.draws
for all
using (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id
      and (
        public.is_superadmin()
        or public.member_role(p.organization_id) in ('superadmin', 'admin')
      )
  )
)
with check (
  exists (
    select 1 from public.promotions p
    where p.id = promotion_id
      and (
        public.is_superadmin()
        or public.member_role(p.organization_id) in ('superadmin', 'admin')
      )
  )
);

create policy "members read audit" on public.audit_events
for select using (organization_id is not null and public.is_org_member(organization_id));

revoke all on function public.is_superadmin() from public;
revoke all on function public.member_role(uuid) from public;
revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.member_role(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;

-- Crie antes o seu usuário em Authentication > Users.
-- Depois substitua o e-mail abaixo e execute apenas este bloco.
do $$
declare
  target_user_id uuid;
  azurra_org_id uuid;
  target_email text := 'SEU_EMAIL_AQUI';
begin
  select id into target_user_id
  from auth.users
  where lower(email) = lower(target_email);

  if target_user_id is null then
    raise exception 'Usuário % não encontrado em Authentication > Users', target_email;
  end if;

  insert into public.profiles (id, full_name, is_superadmin)
  values (target_user_id, split_part(target_email, '@', 1), true)
  on conflict (id) do update set is_superadmin = true;

  insert into public.organizations (name, slug)
  values ('Azurra', 'azurra')
  on conflict (slug) do update set name = excluded.name
  returning id into azurra_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (azurra_org_id, target_user_id, 'superadmin')
  on conflict (organization_id, user_id) do update set role = 'superadmin';
end
$$;
