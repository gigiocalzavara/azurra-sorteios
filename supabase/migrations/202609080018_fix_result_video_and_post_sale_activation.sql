-- Garante que o resultado só seja liberado quando o vídeo estiver pronto
-- e que o fluxo de pós-venda seja criado/reativado para o vencedor.

create or replace function public.ensure_draw_result_and_post_sale(target_draw_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.draws%rowtype;
  p public.promotions%rowtype;
  q public.quotas%rowtype;
  part public.participants%rowtype;
  winner_name text;
  winner_phone text;
begin
  select * into d from public.draws where id = target_draw_id;
  if not found then return; end if;

  select * into p from public.promotions where id = d.promotion_id;
  if not found then return; end if;

  select * into q from public.quotas where id = d.winning_quota_id;
  if not found then return; end if;

  select pr.* into part
  from public.orders o
  join public.participants pr on pr.id = o.participant_id
  where o.id = q.order_id
  limit 1;

  winner_name := coalesce(part.name, d.participant_snapshot->>'name', 'Vencedor');
  winner_phone := coalesce(part.phone_e164, d.participant_snapshot->>'phone');

  if not exists (
    select 1 from public.communication_events
    where promotion_id = p.id and stage = 'result'
  ) then
    perform public.enqueue_communication(
      p.id,
      'result',
      jsonb_build_object('numero_vencedor', q.number, 'vencedor', winner_name, 'media_url', d.video_url)
    );
  end if;

  if coalesce(d.video_url, '') <> '' then
    update public.communication_events
       set media_url = d.video_url,
           rendered_message = '🏆 O resultado de *' || p.name || '* saiu!' || E'\n\n' ||
             'Cota vencedora: *' || q.number::text || '*' || E'\n' ||
             'Vencedor: *' || winner_name || '*' || E'\n\n' ||
             'Assista ao vídeo do sorteio. 🎉',
           status = 'pending',
           attempts = 0,
           sent_at = null,
           sent_manually = false,
           last_error = null,
           updated_at = now()
     where promotion_id = p.id
       and stage = 'result'
       and status <> 'sent';
  end if;

  if part.id is not null and winner_phone is not null then
    insert into public.post_purchase_flows(
      organization_id,promotion_id,participant_id,draw_id,phone_e164,stage,last_error
    ) values (
      p.organization_id,p.id,part.id,d.id,winner_phone,'pending_send',null
    )
    on conflict(draw_id) do update
      set participant_id = excluded.participant_id,
          phone_e164 = excluded.phone_e164,
          stage = case
            when public.post_purchase_flows.stage = 'failed' then 'pending_send'::public.post_purchase_stage
            else public.post_purchase_flows.stage
          end,
          last_error = case
            when public.post_purchase_flows.stage = 'failed' then null
            else public.post_purchase_flows.last_error
          end,
          updated_at = now();
  end if;
end;
$$;

create or replace function public.release_result_when_video_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.video_url,'') <> '' and new.video_url is distinct from old.video_url then
    perform public.ensure_draw_result_and_post_sale(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists draw_video_releases_result on public.draws;
create trigger draw_video_releases_result
after update of video_url on public.draws
for each row execute function public.release_result_when_video_ready();

-- Corrige sorteios já concluídos que ficaram sem resultado enviado ou sem pós-venda.
do $$
declare r record;
begin
  for r in
    select id from public.draws where coalesce(video_url,'') <> ''
  loop
    perform public.ensure_draw_result_and_post_sale(r.id);
  end loop;
end $$;
