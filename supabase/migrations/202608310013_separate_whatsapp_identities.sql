-- Separa telefone, username e LID. Registros da versão anterior são tratados
-- como identidades legadas para impedir disparos para números internos @lid.
alter table public.captured_leads alter column phone_e164 drop not null;
alter table public.captured_leads drop constraint if exists captured_leads_phone_e164_check;
alter table public.captured_leads add column whatsapp_username text;
alter table public.captured_leads add column whatsapp_lid text;
alter table public.captured_leads add column identity_key text;
alter table public.captured_leads add column identity_kind text not null default 'legacy_unverified'
  check (identity_kind in ('phone','username','lid','legacy_unverified'));

-- A versão 012 removia @lid e adicionava +, tornando telefone e LID indistinguíveis.
-- Estes registros ficam fora do CSV até serem capturados novamente pela versão corrigida.
update public.captured_leads
set whatsapp_lid = ltrim(phone_e164, '+') || '@lid',
    phone_e164 = null,
    identity_key = 'legacy:' || id::text,
    identity_kind = 'legacy_unverified'
where identity_key is null;

alter table public.captured_leads alter column identity_key set not null;
alter table public.captured_leads add constraint captured_leads_org_identity_key_unique
  unique (organization_id, identity_key);
create index captured_leads_org_phone_ready_idx on public.captured_leads(organization_id, phone_e164)
  where phone_e164 is not null;
create index captured_leads_org_username_idx on public.captured_leads(organization_id, lower(whatsapp_username))
  where whatsapp_username is not null;
create index captured_leads_org_lid_idx on public.captured_leads(organization_id, whatsapp_lid)
  where whatsapp_lid is not null;
