-- Azurra Sorteios: membros visualizam todas as promoções da própria organização
-- Corrige a listagem de promoções em rascunho no painel administrativo.

create policy "members read organization promotions"
on public.promotions
for select
to authenticated
using (public.is_org_member(organization_id));
