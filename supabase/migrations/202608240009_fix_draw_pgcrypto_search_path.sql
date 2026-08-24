-- O Supabase instala pgcrypto no schema extensions. A função de sorteio
-- foi criada com search_path restrito a public e, por isso, não encontrava digest().
alter function public.perform_promotion_draw(uuid)
  set search_path = public, extensions;
