-- O resultado passa a vir do Sorteador.com.br. O banco valida e registra a cota informada.
create or replace function public.finalize_external_promotion_draw(target_promotion_id uuid,target_winning_number integer,target_result_url text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $function$
declare
 v_promotion public.promotions%rowtype; v_quota public.quotas%rowtype;
 v_participant public.participants%rowtype; v_draw uuid; v_snapshot text; v_result_url text;
begin
 select * into v_promotion from public.promotions where id=target_promotion_id for update;
 if not found then raise exception using message='Promoção não encontrada.'; end if;
 if not (public.is_superadmin() or public.member_role(v_promotion.organization_id) in ('superadmin','admin')) then raise exception using message='Sem permissão para registrar o sorteio.'; end if;
 if v_promotion.status <> 'ready_to_draw' then raise exception using message='O sorteio só é liberado quando todas as cotas estiverem pagas.'; end if;
 if target_winning_number < 1 or target_winning_number > v_promotion.quota_quantity then raise exception using message='O número sorteado está fora da faixa desta promoção.'; end if;
 if exists(select 1 from public.draws where promotion_id=target_promotion_id) then raise exception using message='Esta promoção já foi sorteada.'; end if;
 select * into v_quota from public.quotas where promotion_id=target_promotion_id and number=target_winning_number and status='paid';
 if not found then raise exception using message='A cota sorteada não está paga ou não existe.'; end if;
 select p.* into v_participant from public.orders o join public.participants p on p.id=o.participant_id where o.id=v_quota.order_id;
 if not found then raise exception using message='Participante da cota sorteada não encontrado.'; end if;
 select string_agg(number::text,',' order by number) into v_snapshot from public.quotas where promotion_id=target_promotion_id and status='paid';
 v_result_url:=nullif(trim(coalesce(target_result_url,'')),'');
 if v_result_url is not null and v_result_url !~ '^https://(www\.)?sorteador\.com\.br/(resultado|r)/' then raise exception using message='Informe um link de resultado válido do Sorteador.com.br.'; end if;
 insert into public.draws(promotion_id,winning_quota_id,participant_snapshot,quotas_snapshot_hash,draw_seed_hash,drawn_by)
 values(target_promotion_id,v_quota.id,jsonb_build_object('id',v_participant.id,'name',v_participant.name,'phone',v_participant.phone_e164,'source','sorteador.com.br','result_url',v_result_url),encode(digest(v_snapshot,'sha256'),'hex'),encode(digest(coalesce(v_result_url,'sorteador.com.br')||':'||target_winning_number::text||':'||clock_timestamp()::text,'sha256'),'hex'),auth.uid()) returning id into v_draw;
 update public.promotions set status='drawn',drawn_at=now() where id=target_promotion_id;
 insert into public.audit_events(organization_id,actor_user_id,event_type,entity_type,entity_id,payload) values(v_promotion.organization_id,auth.uid(),'external_promotion_drawn','promotion',target_promotion_id,jsonb_build_object('draw_id',v_draw,'winning_number',target_winning_number,'source','sorteador.com.br','result_url',v_result_url));
 return jsonb_build_object('draw_id',v_draw,'winning_number',target_winning_number,'winner_name',v_participant.name,'winner_phone',v_participant.phone_e164);
end;$function$;
revoke all on function public.finalize_external_promotion_draw(uuid,integer,text) from public;
grant execute on function public.finalize_external_promotion_draw(uuid,integer,text) to authenticated;
