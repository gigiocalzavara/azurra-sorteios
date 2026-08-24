-- Operações administrativas de pagamentos, configurações e sorteio.

drop policy if exists "admins update own organization" on public.organizations;

create policy "admins update own organization"
on public.organizations for update to authenticated
using (public.is_superadmin() or public.member_role(id) in ('superadmin','admin'))
with check (public.is_superadmin() or public.member_role(id) in ('superadmin','admin'));

create or replace function public.confirm_order_payment(target_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_order public.orders%rowtype; v_org uuid; v_remaining integer;
begin
 select o.* into v_order from public.orders o where o.id=target_order_id for update;
 if not found then raise exception 'Pedido não encontrado.'; end if;
 select p.organization_id into v_org from public.promotions p where p.id=v_order.promotion_id;
 if not (public.is_superadmin() or public.member_role(v_org) in ('superadmin','admin','manager')) then raise exception 'Sem permissão.'; end if;
 if v_order.status not in ('pending','payment_reported') then raise exception 'Este pedido não está pendente.'; end if;
 update public.orders set status='paid',paid_at=now(),confirmed_by=auth.uid(),updated_at=now() where id=target_order_id;
 update public.quotas set status='paid',paid_at=now() where order_id=target_order_id and status='reserved';
 select count(*) into v_remaining from public.quotas where promotion_id=v_order.promotion_id and status<>'paid';
 if v_remaining=0 then update public.promotions set status='ready_to_draw',sold_out_at=coalesce(sold_out_at,now()) where id=v_order.promotion_id and status in ('published','sold_out'); end if;
 insert into public.audit_events(organization_id,actor_user_id,event_type,entity_type,entity_id) values(v_org,auth.uid(),'payment_confirmed','order',target_order_id);
 return jsonb_build_object('order_id',target_order_id,'status','paid','remaining',v_remaining);
end $$;

create or replace function public.perform_promotion_draw(target_promotion_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_promotion public.promotions%rowtype; v_quota public.quotas%rowtype; v_participant public.participants%rowtype; v_draw uuid; v_snapshot text;
begin
 select * into v_promotion from public.promotions where id=target_promotion_id for update;
 if not found then raise exception 'Promoção não encontrada.'; end if;
 if not (public.is_superadmin() or public.member_role(v_promotion.organization_id) in ('superadmin','admin')) then raise exception 'Sem permissão.'; end if;
 if v_promotion.status<>'ready_to_draw' then
   raise exception using message='O sorteio só é liberado quando todas as cotas estiverem pagas.';
 end if;
 if exists(select 1 from public.draws where promotion_id=target_promotion_id) then raise exception 'Esta promoção já foi sorteada.'; end if;
 select q.* into v_quota from public.quotas q where q.promotion_id=target_promotion_id and q.status='paid' order by gen_random_uuid() limit 1;
 select part.* into v_participant from public.orders o join public.participants part on part.id=o.participant_id where o.id=v_quota.order_id;
 select string_agg(q.number::text,',' order by q.number) into v_snapshot from public.quotas q where q.promotion_id=target_promotion_id and q.status='paid';
 insert into public.draws(promotion_id,winning_quota_id,participant_snapshot,quotas_snapshot_hash,draw_seed_hash,drawn_by)
 values(target_promotion_id,v_quota.id,jsonb_build_object('id',v_participant.id,'name',v_participant.name,'phone',v_participant.phone_e164),encode(digest(v_snapshot,'sha256'),'hex'),encode(digest(gen_random_uuid()::text,'sha256'),'hex'),auth.uid()) returning id into v_draw;
 update public.promotions set status='drawn',drawn_at=now() where id=target_promotion_id;
 insert into public.audit_events(organization_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_promotion.organization_id,auth.uid(),'promotion_drawn','promotion',target_promotion_id,jsonb_build_object('draw_id',v_draw,'winning_number',v_quota.number));
 return jsonb_build_object('draw_id',v_draw,'winning_number',v_quota.number,'winner_name',v_participant.name,'winner_phone',v_participant.phone_e164);
end $$;

revoke all on function public.confirm_order_payment(uuid) from public;
revoke all on function public.perform_promotion_draw(uuid) from public;
grant execute on function public.confirm_order_payment(uuid) to authenticated;
grant execute on function public.perform_promotion_draw(uuid) to authenticated;
