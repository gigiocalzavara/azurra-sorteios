-- Operação manual do pós-venda e normalização dos modelos de comunicação.

alter table public.post_purchase_flows
  add column if not exists operator_status text not null default 'automated'
    check (operator_status in ('automated','awaiting_pix_contact','awaiting_shipping','pix_paid','product_sent','completed')),
  add column if not exists operator_completed_at timestamptz;

create index if not exists post_purchase_flows_operator_status_idx
  on public.post_purchase_flows(organization_id, operator_status, created_at desc);

-- O fluxo automatizado termina quando a escolha/endereço foi coletado; a execução
-- financeira/logística permanece sob controle do operador.
update public.post_purchase_flows
set operator_status = case
  when reward_type = 'pix' and stage = 'completed' then 'awaiting_pix_contact'
  when reward_type = 'product' and stage = 'completed' then 'awaiting_shipping'
  else operator_status
end
where operator_status = 'automated';

-- Permite que operadores/gestores concluam a etapa operacional.
drop policy if exists "members update post purchase flows" on public.post_purchase_flows;
create policy "members update post purchase flows" on public.post_purchase_flows
for update to authenticated
using (public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager','operator'))
with check (public.is_superadmin() or public.member_role(organization_id) in ('superadmin','admin','manager','operator'));

-- As migrations antigas gravaram alguns modelos com os caracteres literais \n.
-- Converte para quebras de linha reais no WhatsApp e na interface.
update public.communication_templates
set message_template = replace(message_template, E'\\n', E'\n'),
    updated_at = now()
where message_template like '%\\n%';

update public.communication_events
set rendered_message = replace(rendered_message, E'\\n', E'\n'),
    updated_at = now()
where status in ('pending','manual_required','failed')
  and rendered_message like '%\\n%';
