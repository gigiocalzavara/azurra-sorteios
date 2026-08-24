-- Substitui a função de sorteio sem marcadores de formatação em RAISE.

create or replace function public.perform_promotion_draw(target_promotion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_promotion public.promotions%rowtype;
  v_quota public.quotas%rowtype;
  v_participant public.participants%rowtype;
  v_draw uuid;
  v_snapshot text;
begin
  select *
    into v_promotion
    from public.promotions
   where id = target_promotion_id
   for update;

  if not found then
    raise exception using message = 'Promoção não encontrada.';
  end if;

  if not (
    public.is_superadmin()
    or public.member_role(v_promotion.organization_id) in ('superadmin', 'admin')
  ) then
    raise exception using message = 'Sem permissão para realizar o sorteio.';
  end if;

  if v_promotion.status <> 'ready_to_draw' then
    raise exception using message =
      'O sorteio só é liberado quando todas as cotas estiverem pagas.';
  end if;

  if exists (
    select 1 from public.draws where promotion_id = target_promotion_id
  ) then
    raise exception using message = 'Esta promoção já foi sorteada.';
  end if;

  select q.*
    into v_quota
    from public.quotas q
   where q.promotion_id = target_promotion_id
     and q.status = 'paid'
   order by gen_random_uuid()
   limit 1;

  if not found then
    raise exception using message = 'Nenhuma cota paga disponível para o sorteio.';
  end if;

  select participant.*
    into v_participant
    from public.orders order_record
    join public.participants participant
      on participant.id = order_record.participant_id
   where order_record.id = v_quota.order_id;

  if not found then
    raise exception using message = 'Participante da cota sorteada não encontrado.';
  end if;

  select string_agg(q.number::text, ',' order by q.number)
    into v_snapshot
    from public.quotas q
   where q.promotion_id = target_promotion_id
     and q.status = 'paid';

  insert into public.draws (
    promotion_id,
    winning_quota_id,
    participant_snapshot,
    quotas_snapshot_hash,
    draw_seed_hash,
    drawn_by
  )
  values (
    target_promotion_id,
    v_quota.id,
    jsonb_build_object(
      'id', v_participant.id,
      'name', v_participant.name,
      'phone', v_participant.phone_e164
    ),
    encode(digest(v_snapshot, 'sha256'), 'hex'),
    encode(digest(gen_random_uuid()::text, 'sha256'), 'hex'),
    auth.uid()
  )
  returning id into v_draw;

  update public.promotions
     set status = 'drawn',
         drawn_at = now()
   where id = target_promotion_id;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_promotion.organization_id,
    auth.uid(),
    'promotion_drawn',
    'promotion',
    target_promotion_id,
    jsonb_build_object(
      'draw_id', v_draw,
      'winning_number', v_quota.number
    )
  );

  return jsonb_build_object(
    'draw_id', v_draw,
    'winning_number', v_quota.number,
    'winner_name', v_participant.name,
    'winner_phone', v_participant.phone_e164
  );
end;
$function$;

revoke all on function public.perform_promotion_draw(uuid) from public;
grant execute on function public.perform_promotion_draw(uuid) to authenticated;
