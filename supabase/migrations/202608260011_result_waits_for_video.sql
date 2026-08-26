-- O resultado só entra na fila automática quando o vídeo estiver disponível.

create or replace function public.hold_result_until_video()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage = 'result' and coalesce(new.media_url, '') = '' and new.status = 'pending' then
    new.status := 'manual_required';
    new.last_error := 'Aguardando a gravação do vídeo do sorteio.';
  end if;
  return new;
end;
$$;

drop trigger if exists communication_result_requires_video on public.communication_events;
create trigger communication_result_requires_video
before insert or update of status, media_url on public.communication_events
for each row execute function public.hold_result_until_video();

create or replace function public.release_result_when_video_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  promotion_name text;
begin
  if new.video_url is not null
     and new.video_url <> '' then
    select name into promotion_name from public.promotions where id = new.promotion_id;
    update public.communication_events
       set media_url = new.video_url,
           rendered_message = '🏆 O resultado de *' || promotion_name || '* saiu!' || E'\n\n' || 'Assista ao vídeo e descubra a cota vencedora. 🎉',
           status = 'pending',
           attempts = 0,
           sent_at = null,
           sent_manually = false,
           last_error = null,
           updated_at = now()
     where promotion_id = new.promotion_id
       and stage = 'result';
  end if;
  return new;
end;
$$;

drop trigger if exists draw_video_releases_result on public.draws;
create trigger draw_video_releases_result
after update of video_url on public.draws
for each row execute function public.release_result_when_video_ready();

update public.communication_templates
   set message_template = '🏆 O resultado de *{{promocao}}* saiu!' || E'\n\n' || 'Assista ao vídeo e descubra a cota vencedora. 🎉',
       updated_at = now()
 where stage = 'result';

update public.communication_events ce
   set media_url = d.video_url,
       rendered_message = '🏆 O resultado de *' || p.name || '* saiu!' || E'\n\n' || 'Assista ao vídeo e descubra a cota vencedora. 🎉',
       status = 'pending',
       attempts = 0,
       sent_at = null,
       sent_manually = false,
       last_error = null,
       updated_at = now()
  from public.draws d
  join public.promotions p on p.id = d.promotion_id
 where ce.promotion_id = d.promotion_id
   and ce.stage = 'result'
   and coalesce(d.video_url, '') <> '';

update public.communication_events
   set status = 'manual_required',
       last_error = 'Aguardando a gravação do vídeo do sorteio.',
       updated_at = now()
 where stage = 'result'
   and coalesce(media_url, '') = ''
   and status <> 'sent';
