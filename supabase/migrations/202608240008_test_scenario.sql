alter table public.promotions add column if not exists is_test boolean not null default false;

create or replace function public.create_test_scenario()
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare v_org uuid;v_promotion uuid;v_participant uuid;v_order uuid;v_slug text;
begin
 select om.organization_id into v_org from public.organization_members om where om.user_id=auth.uid() order by om.created_at limit 1;
 if v_org is null and public.is_superadmin() then select id into v_org from public.organizations where active=true order by created_at limit 1;end if;
 if v_org is null then raise exception using message='Organização não encontrada.';end if;
 if not(public.is_superadmin() or public.member_role(v_org) in('superadmin','admin')) then raise exception using message='Sem permissão para criar cenário de teste.';end if;
 v_slug:='teste-fluxo-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISS');
 insert into public.promotions(organization_id,name,slug,description,special_condition,quota_quantity,quota_price,minimum_per_order,maximum_per_order,reservation_minutes,status,published_at,created_by,is_test)
 values(v_org,'[TESTE] Fluxo completo',v_slug,'Promoção para validar página pública, pagamentos e sorteio sem operação bancária.','AMBIENTE DE TESTE — não realizar transferência PIX.',10,1,1,2,60,'published',now(),auth.uid(),true) returning id into v_promotion;
 insert into public.participants(organization_id,name,phone_e164,consent_at) values(v_org,'Participante de Teste','+5599999999999',now())
 on conflict(organization_id,phone_e164) do update set name=excluded.name,updated_at=now() returning id into v_participant;
 insert into public.orders(promotion_id,participant_id,status,quota_count,unit_price,payer_name,payment_reported_at,reservation_expires_at)
 values(v_promotion,v_participant,'payment_reported',8,1,'PAGAMENTO DE TESTE',now(),now()+interval '24 hours') returning id into v_order;
 update public.quotas set status='reserved',order_id=v_order,reserved_at=now()
 where id in(select id from public.quotas where promotion_id=v_promotion and status='available' order by number limit 8);
 return jsonb_build_object('promotion_id',v_promotion,'slug',v_slug);
end;$function$;
revoke all on function public.create_test_scenario() from public;
grant execute on function public.create_test_scenario() to authenticated;
