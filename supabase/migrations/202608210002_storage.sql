-- Storage do Azurra Sorteios
-- Execute depois da migration foundation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'promotion-images',
  'promotion-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "public reads promotion images"
on storage.objects for select
using (bucket_id = 'promotion-images');

create policy "members upload promotion images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'promotion-images'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "members update promotion images"
on storage.objects for update to authenticated
using (
  bucket_id = 'promotion-images'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'promotion-images'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "members delete promotion images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'promotion-images'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "members read payment proofs"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "members upload payment proofs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "members update payment proofs"
on storage.objects for update to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'payment-proofs'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "members delete payment proofs"
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);
