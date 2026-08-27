-- Migration 017: Bucket de anexos no Supabase Storage
-- Cria o bucket público 'attachments' e políticas para usuários autenticados.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

drop policy if exists "attachments public read" on storage.objects;
create policy "attachments public read" on storage.objects for select using (bucket_id = 'attachments');

drop policy if exists "attachments authenticated insert" on storage.objects;
create policy "attachments authenticated insert" on storage.objects for insert to authenticated with check (bucket_id = 'attachments');

drop policy if exists "attachments authenticated delete" on storage.objects;
create policy "attachments authenticated delete" on storage.objects for delete to authenticated using (bucket_id = 'attachments');
