-- 019_onleave_documents.sql — Ausência/cobertura de operador + documentos
alter table public.operators add column if not exists on_leave boolean default false;
alter table public.clients add column if not exists documents jsonb default '[]'::jsonb;
