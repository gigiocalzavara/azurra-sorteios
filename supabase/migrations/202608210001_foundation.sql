create extension if not exists pgcrypto;

create type public.app_role as enum ('superadmin', 'admin', 'manager', 'operator');
create type public.promotion_status as enum (
  'draft',
  'published',
  'sold_out',
  'ready_to_draw',
  'drawn',
  'cancelled'
);
create type public.order_status as enum (
  'pending',
  'payment_reported',
  'paid',
  'expired',
  'cancelled',
  'payment_conflict'
);
create type public.quota_status as enum ('available', 'reserved', 'paid', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  primary_color text not null default '#6900ff',
  secondary_color text not null default '#00f0ff',
  pix_key text,
  pix_key_type text,
  pix_receiver_name text,
  pix_receiver_city text,
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
  slug text not null,
  description text not null,
  special_condition text,
  product_image_url text,
  quota_quantity integer not null check (quota_quantity > 0),
  quota_price numeric(12,2) not null check (quota_price > 0),
  minimum_per_order integer not null default 1 check (minimum_per_order > 0),
  reservation_minutes integer not null default 30 check (reservation_minutes between 5 and 1440),
  status public.promotion_status not null default 'draft',
  published_at timestamptz,
  sold_out_at timestamptz,
  drawn_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone_e164 text not null,
  created_at timestamptz not null default now(),
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
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
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
  drawn_by uuid references auth.users(id),
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

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.promotions enable row level security;
alter table public.participants enable row level security;
alter table public.orders enable row level security;
alter table public.quotas enable row level security;
alter table public.draws enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

create policy "members read organizations"
on public.organizations for select
using (public.is_org_member(id));

create policy "members read promotions"
on public.promotions for select
using (public.is_org_member(organization_id));

create index promotions_org_status_idx on public.promotions(organization_id, status);
create index orders_promotion_status_idx on public.orders(promotion_id, status);
create index quotas_promotion_status_idx on public.quotas(promotion_id, status);
create index participants_org_phone_idx on public.participants(organization_id, phone_e164);
