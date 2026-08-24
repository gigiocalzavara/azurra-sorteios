-- Funil de comunicação, contingência manual e mídia do resultado.

create type public.communication_stage as enum ('launch','first_purchase','progress_50','progress_60','progress_85','last_quota','sold_out','result');
create type public.communication_status as enum ('pending','manual_required','sent','failed','skipped');

create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage public.communication_stage not null,
  title text not null,
  message_template text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,stage)
);

create table public.promotion_communication_settings (
  promotion_id uuid primary key references public.promotions(id) on delete cascade,
  mode text not null default 'approval' check(mode in ('automatic','approval','manual')),
  group_jid text,
  group_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.communication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  stage public.communication_stage not null,
  rendered_message text not null,
  payload jsonb not null default '{}'::jsonb,
  media_url text,
  status public.communication_status not null default 'pending',
  attempts integer not null default 0,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_manually boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(promotion_id,stage)
);

alter table public.draws add column if not exists video_url text;
create index communication_events_queue_idx on public.communication_events(status,scheduled_at);
alter table public.communication_templates enable row level security;
alter table public.promotion_communication_settings enable row level security;
alter table public.communication_events enable row level security;

create policy "members manage communication templates" on public.communication_templates for all to authenticated
using(public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager'))
with check(public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager'));
create policy "members manage promotion communication" on public.promotion_communication_settings for all to authenticated
using(exists(select 1 from public.promotions p where p.id=promotion_id and (public.is_superadmin() or public.member_role(p.organization_id) in ('superadmin','admin','manager'))))
with check(exists(select 1 from public.promotions p where p.id=promotion_id and (public.is_superadmin() or public.member_role(p.organization_id) in ('superadmin','admin','manager'))));
create policy "members manage communication events" on public.communication_events for all to authenticated
using(public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager'))
with check(public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager'));

create or replace function public.ensure_communication_templates(target_organization_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.communication_templates(organization_id,stage,title,message_template) values
 (target_organization_id,'launch','Lançamento','🎉 *{{promocao}}* está no ar!\n\nGaranta suas cotas por *{{valor_cota}}* cada. Os números são escolhidos aleatoriamente entre os disponíveis.\n\n👉 {{link}}'),
 (target_organization_id,'first_purchase','Primeira participação','🚀 Começou! A primeira participação na promoção *{{promocao}}* já foi confirmada.\n\nQuem será o próximo? 👉 {{link}}'),
 (target_organization_id,'progress_50','50% vendido','🔥 Já alcançamos *50% das cotas* de {{promocao}}!\n\nAinda dá tempo: {{link}}'),
 (target_organization_id,'progress_60','60% vendido','⚡ Passamos de *60% das cotas vendidas*! A promoção {{promocao}} está acelerando.\n\nEscolha suas cotas: {{link}}'),
 (target_organization_id,'progress_85','85% vendido','🚨 *85% das cotas já foram!* Estamos na reta final de {{promocao}}.\n\nGaranta agora: {{link}}'),
 (target_organization_id,'last_quota','Última cota','🚨 *FALTA APENAS 1 COTA* para fechar {{promocao}}!\n\nQuem vai garantir a última? {{link}}'),
 (target_organization_id,'sold_out','Cotas encerradas','✅ *FECHOU!* Todas as cotas de {{promocao}} foram pagas.\n\nO sorteio já está liberado. Fiquem ligados para o resultado!'),
 (target_organization_id,'result','Resultado','🏆 Temos o resultado de *{{promocao}}*!\n\nNúmero sorteado: *{{numero_vencedor}}*\nVencedor(a): *{{vencedor}}*\n\nParabéns! 🎉')
 on conflict(organization_id,stage) do nothing;
end;$$;

create or replace function public.enqueue_communication(target_promotion_id uuid,target_stage public.communication_stage,extra jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare p public.promotions%rowtype;o public.organizations%rowtype;t public.communication_templates%rowtype;s public.promotion_communication_settings%rowtype;msg text;eid uuid;link text;st public.communication_status;
begin
 select * into p from public.promotions where id=target_promotion_id;if not found then return null;end if;
 select * into o from public.organizations where id=p.organization_id;
 perform public.ensure_communication_templates(p.organization_id);
 insert into public.promotion_communication_settings(promotion_id) values(p.id) on conflict do nothing;
 select * into t from public.communication_templates where organization_id=p.organization_id and stage=target_stage;
 select * into s from public.promotion_communication_settings where promotion_id=p.id;
 if not t.enabled or not s.active then return null;end if;
 link:='https://sorteios.azurratech.com.br/p/'||o.slug||'/'||p.slug;
 msg:=replace(replace(replace(replace(replace(replace(t.message_template,'{{promocao}}',p.name),'{{valor_cota}}','R$ '||replace(to_char(p.quota_price,'FM999G999G990D00'),'.',',')),'{{link}}',link),'{{percentual}}',coalesce(extra->>'percentual','')),'{{numero_vencedor}}',coalesce(extra->>'numero_vencedor','')),'{{vencedor}}',coalesce(extra->>'vencedor',''));
 msg:=replace(msg,'{{cotas_restantes}}',coalesce(extra->>'cotas_restantes',''));
 st:=case when s.mode='automatic' and s.group_jid is not null then 'pending'::public.communication_status else 'manual_required'::public.communication_status end;
 insert into public.communication_events(organization_id,promotion_id,stage,rendered_message,payload,status,media_url)
 values(p.organization_id,p.id,target_stage,msg,extra||jsonb_build_object('link',link),st,extra->>'media_url') on conflict(promotion_id,stage) do nothing returning id into eid;
 return eid;
end;$$;

create or replace function public.promotion_communication_trigger() returns trigger language plpgsql security definer set search_path=public as $$
declare d public.draws%rowtype;q integer;w text;
begin
 if new.status='published' and old.status is distinct from new.status then perform public.enqueue_communication(new.id,'launch');end if;
 if new.status='ready_to_draw' and old.status is distinct from new.status then perform public.enqueue_communication(new.id,'sold_out');end if;
 if new.status='drawn' and old.status is distinct from new.status then
  select * into d from public.draws where promotion_id=new.id;select number into q from public.quotas where id=d.winning_quota_id;w:=d.participant_snapshot->>'name';
  perform public.enqueue_communication(new.id,'result',jsonb_build_object('numero_vencedor',q,'vencedor',w,'media_url',d.video_url));
 end if;return new;
end;$$;
drop trigger if exists promotion_communication_status on public.promotions;
create trigger promotion_communication_status after update of status on public.promotions for each row execute function public.promotion_communication_trigger();

create or replace function public.quota_communication_trigger() returns trigger language plpgsql security definer set search_path=public as $$
declare pid uuid;paid_count integer;total integer;percent numeric;remaining integer;selected_stage public.communication_stage;
begin
 for pid in select distinct promotion_id from new_paid loop
  select count(*) filter(where status='paid'),count(*) into paid_count,total from public.quotas where promotion_id=pid;remaining:=total-paid_count;percent:=paid_count*100.0/nullif(total,0);
  if paid_count>0 then perform public.enqueue_communication(pid,'first_purchase');end if;
  if percent>=85 then selected_stage:='progress_85';elsif percent>=60 then selected_stage:='progress_60';elsif percent>=50 then selected_stage:='progress_50';else selected_stage:=null;end if;
  if selected_stage is not null and not exists(select 1 from public.communication_events ce where ce.promotion_id=pid and ce.stage=selected_stage) then perform public.enqueue_communication(pid,selected_stage,jsonb_build_object('percentual',floor(percent)));end if;
  if remaining=1 then perform public.enqueue_communication(pid,'last_quota',jsonb_build_object('cotas_restantes',1));end if;
 end loop;return null;
end;$$;
drop trigger if exists quota_communication_paid on public.quotas;
create trigger quota_communication_paid after update on public.quotas referencing new table as new_paid for each statement execute function public.quota_communication_trigger();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('draw-videos','draw-videos',true,52428800,array['video/mp4','video/webm']) on conflict(id) do update set public=true,file_size_limit=52428800,allowed_mime_types=array['video/mp4','video/webm'];
create policy "authenticated upload draw videos" on storage.objects for insert to authenticated with check(bucket_id='draw-videos');
create policy "public read draw videos" on storage.objects for select to public using(bucket_id='draw-videos');
create policy "authenticated update draw videos" on storage.objects for update to authenticated using(bucket_id='draw-videos') with check(bucket_id='draw-videos');

do $$ declare oid uuid;begin for oid in select id from public.organizations loop perform public.ensure_communication_templates(oid);end loop;end $$;
