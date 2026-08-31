-- Captura de leads por grupos usando uma sessão Baileys exclusiva e sem envio.
create table public.captured_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  display_name text,
  consent_status text not null default 'not_confirmed'
    check (consent_status in ('not_confirmed','confirmed','opted_out')),
  first_captured_at timestamptz not null default now(),
  last_captured_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (organization_id, phone_e164)
);

create table public.lead_capture_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_jid text not null,
  group_name text not null,
  found_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.captured_lead_sources (
  lead_id uuid not null references public.captured_leads(id) on delete cascade,
  group_jid text not null,
  group_name text not null,
  first_captured_at timestamptz not null default now(),
  last_captured_at timestamptz not null default now(),
  capture_run_id uuid references public.lead_capture_runs(id) on delete set null,
  primary key (lead_id, group_jid)
);

create index captured_leads_org_created_idx on public.captured_leads(organization_id, last_captured_at desc);
create index lead_capture_runs_org_created_idx on public.lead_capture_runs(organization_id, created_at desc);
alter table public.captured_leads enable row level security;
alter table public.lead_capture_runs enable row level security;
alter table public.captured_lead_sources enable row level security;

create policy "members manage captured leads" on public.captured_leads for all
using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage capture runs" on public.lead_capture_runs for all
using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage lead sources" on public.captured_lead_sources for all
using (exists(select 1 from public.captured_leads l where l.id=lead_id and public.is_org_member(l.organization_id)))
with check (exists(select 1 from public.captured_leads l where l.id=lead_id and public.is_org_member(l.organization_id)));
