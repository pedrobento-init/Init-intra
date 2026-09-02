-- ============================================================================
-- Init Intra – Migração completa do schema Supabase (idempotente)
-- Rode no SQL Editor do Supabase
-- ============================================================================

-- 1. OPERATORS
create table if not exists public.operators (
  id text primary key,
  name text not null,
  initials text,
  color text,
  role text default 'Técnico',
  phone text,
  email text,
  pin_hash text,
  pin_salt text,
  is_admin boolean default false,
  active boolean default true,
  team text default 'init',
  auth_user_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Garante TODAS as colunas (idempotente, mesmo se a tabela já existia)
alter table public.operators add column if not exists name text;
alter table public.operators add column if not exists initials text;
alter table public.operators add column if not exists color text;
alter table public.operators add column if not exists role text default 'Técnico';
alter table public.operators add column if not exists phone text;
alter table public.operators add column if not exists email text;
alter table public.operators add column if not exists pin_hash text;
alter table public.operators add column if not exists pin_salt text;
alter table public.operators add column if not exists is_admin boolean default false;
alter table public.operators add column if not exists active boolean default true;
alter table public.operators add column if not exists team text default 'init';
alter table public.operators add column if not exists auth_user_id uuid;
alter table public.operators add column if not exists created_at timestamptz default now();
alter table public.operators add column if not exists updated_at timestamptz default now();
create index if not exists idx_operators_email on public.operators(email);
create index if not exists idx_operators_auth_user_id on public.operators(auth_user_id);
create index if not exists idx_operators_team on public.operators(team);
alter table public.operators enable row level security;
drop policy if exists "operators all" on public.operators;
create policy "operators all" on public.operators for all using (true) with check (true);

-- 2. CLIENTS
create table if not exists public.clients (
  id text primary key,
  name text not null,
  cnpj text,
  segment text,
  color text,
  initials text,
  logo text,
  logo_shape text default 'circle',
  owner text,
  owner_phone text,
  responsible text,
  responsible_phone text,
  technician text,
  server jsonb,
  hosting jsonb,
  backup jsonb,
  licenses jsonb,
  emails jsonb,
  google_sheet_url text,
  team text default 'init',
  notes text,
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.clients add column if not exists name text;
alter table public.clients add column if not exists cnpj text;
alter table public.clients add column if not exists segment text;
alter table public.clients add column if not exists color text;
alter table public.clients add column if not exists initials text;
alter table public.clients add column if not exists logo text;
alter table public.clients add column if not exists logo_shape text default 'circle';
alter table public.clients add column if not exists owner text;
alter table public.clients add column if not exists owner_phone text;
alter table public.clients add column if not exists responsible text;
alter table public.clients add column if not exists responsible_phone text;
alter table public.clients add column if not exists technician text;
alter table public.clients add column if not exists server jsonb;
alter table public.clients add column if not exists hosting jsonb;
alter table public.clients add column if not exists backup jsonb;
alter table public.clients add column if not exists licenses jsonb;
alter table public.clients add column if not exists emails jsonb;
alter table public.clients add column if not exists google_sheet_url text;
alter table public.clients add column if not exists team text default 'init';
alter table public.clients add column if not exists notes text;
alter table public.clients add column if not exists attachments jsonb default '[]'::jsonb;
alter table public.clients add column if not exists created_at timestamptz default now();
alter table public.clients add column if not exists updated_at timestamptz default now();
create index if not exists idx_clients_team on public.clients(team);
alter table public.clients enable row level security;
drop policy if exists "clients all" on public.clients;
create policy "clients all" on public.clients for all using (true) with check (true);

-- 3. PENDENCIAS
create table if not exists public.pendencias (
  id text primary key,
  client_id text,
  client_name text,
  tipo text,
  descricao text,
  responsible text,
  status text default 'aberto',
  priority text default 'media',
  deadline date,
  notes jsonb default '[]'::jsonb,
  link_util text,
  team text default 'init',
  attachments jsonb default '[]'::jsonb,
  checklist jsonb default '[]'::jsonb,
  tags jsonb default '[]'::jsonb,
  timer_running boolean default false,
  timer_started_at timestamptz,
  timer_total_seconds integer default 0,
  timer_operator text,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.pendencias add column if not exists client_id text;
alter table public.pendencias add column if not exists client_name text;
alter table public.pendencias add column if not exists tipo text;
alter table public.pendencias add column if not exists descricao text;
alter table public.pendencias add column if not exists responsible text;
alter table public.pendencias add column if not exists status text default 'aberto';
alter table public.pendencias add column if not exists priority text default 'media';
alter table public.pendencias add column if not exists deadline date;
alter table public.pendencias add column if not exists notes jsonb default '[]'::jsonb;
alter table public.pendencias add column if not exists link_util text;
alter table public.pendencias add column if not exists team text default 'init';
alter table public.pendencias add column if not exists attachments jsonb default '[]'::jsonb;
alter table public.pendencias add column if not exists checklist jsonb default '[]'::jsonb;
alter table public.pendencias add column if not exists tags jsonb default '[]'::jsonb;
alter table public.pendencias add column if not exists recurrence text;
alter table public.pendencias add column if not exists visit_id text;
alter table public.pendencias add column if not exists timer_running boolean default false;
alter table public.pendencias add column if not exists timer_started_at timestamptz;
alter table public.pendencias add column if not exists timer_total_seconds integer default 0;
alter table public.pendencias add column if not exists timer_operator text;
alter table public.pendencias add column if not exists completed_at timestamptz;
alter table public.pendencias add column if not exists reviewed_in_meeting text;
alter table public.pendencias add column if not exists created_at timestamptz default now();
alter table public.pendencias add column if not exists updated_at timestamptz default now();
create index if not exists idx_pendencias_team on public.pendencias(team);
create index if not exists idx_pendencias_status on public.pendencias(status);
alter table public.pendencias enable row level security;
drop policy if exists "pendencias all" on public.pendencias;
create policy "pendencias all" on public.pendencias for all using (true) with check (true);

-- 4. VISITS
create table if not exists public.visits (
  id text primary key,
  client_id text,
  client_name text,
  operator text,
  date date,
  "time" time,
  motivo text,
  observacoes text,
  status text default 'agendada',
  team text default 'init',
  categories jsonb default '[]'::jsonb,
  checklist  jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.visits add column if not exists client_id text;
alter table public.visits add column if not exists client_name text;
alter table public.visits add column if not exists operator text;
alter table public.visits add column if not exists date date;
alter table public.visits add column if not exists "time" time;
alter table public.visits add column if not exists time_end time;
alter table public.visits add column if not exists all_day boolean default false;
alter table public.visits add column if not exists motivo text;
alter table public.visits add column if not exists observacoes text;
alter table public.visits add column if not exists relatorio text;
alter table public.visits add column if not exists recurrence text;
alter table public.visits add column if not exists status text default 'agendada';
alter table public.visits add column if not exists team text default 'init';
alter table public.visits add column if not exists categories jsonb default '[]'::jsonb;
alter table public.visits add column if not exists checklist  jsonb default '[]'::jsonb;
alter table public.visits add column if not exists created_at timestamptz default now();
alter table public.visits add column if not exists updated_at timestamptz default now();
create index if not exists idx_visits_team on public.visits(team);
create index if not exists idx_visits_status on public.visits(status);
create index if not exists idx_visits_date on public.visits(date);
alter table public.visits enable row level security;
drop policy if exists "visits all" on public.visits;
create policy "visits all" on public.visits for all using (true) with check (true);

-- 5. PROCEDURES
create table if not exists public.procedures (
  id text primary key,
  client_id text,
  title text,
  category text,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.procedures add column if not exists client_id text;
alter table public.procedures add column if not exists title text;
alter table public.procedures add column if not exists category text;
alter table public.procedures add column if not exists content text;
alter table public.procedures add column if not exists created_at timestamptz default now();
alter table public.procedures add column if not exists updated_at timestamptz default now();
alter table public.procedures enable row level security;
drop policy if exists "procedures all" on public.procedures;
create policy "procedures all" on public.procedures for all using (true) with check (true);

-- 6. PROCEDURE_TEMPLATES
create table if not exists public.procedure_templates (
  id text primary key,
  title text,
  category text,
  content text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.procedure_templates add column if not exists title text;
alter table public.procedure_templates add column if not exists category text;
alter table public.procedure_templates add column if not exists content text;
alter table public.procedure_templates add column if not exists created_by text;
alter table public.procedure_templates add column if not exists created_at timestamptz default now();
alter table public.procedure_templates add column if not exists updated_at timestamptz default now();
alter table public.procedure_templates enable row level security;
drop policy if exists "procedure_templates all" on public.procedure_templates;
create policy "procedure_templates all" on public.procedure_templates for all using (true) with check (true);

-- 7. AUDIT_LOGS
create table if not exists public.audit_logs (
  id bigserial primary key,
  operator_name text,
  action text,
  type text,
  target_id text,
  details text,
  timestamp timestamptz default now()
);
alter table public.audit_logs add column if not exists operator_name text;
alter table public.audit_logs add column if not exists action text;
alter table public.audit_logs add column if not exists type text;
alter table public.audit_logs add column if not exists target_id text;
alter table public.audit_logs add column if not exists details text;
alter table public.audit_logs add column if not exists timestamp timestamptz default now();
alter table public.audit_logs enable row level security;
drop policy if exists "audit_logs all" on public.audit_logs;
create policy "audit_logs all" on public.audit_logs for all using (true) with check (true);

-- 9. Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.operators; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.clients;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.pendencias; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.visits;    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.procedures; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.procedure_templates; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.audit_logs; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.reunioes; exception when duplicate_object then null; end;
  end if;
end $$;

-- 10. REUNIÕES
create table if not exists public.reunioes (
  id text primary key,
  mes_ano text,
  status text default 'aberta',
  started_at timestamptz,
  ended_at timestamptz,
  team text default 'init',
  relatorio text default '',
  participants jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.reunioes add column if not exists mes_ano text;
alter table public.reunioes add column if not exists status text default 'aberta';
alter table public.reunioes add column if not exists started_at timestamptz;
alter table public.reunioes add column if not exists ended_at timestamptz;
alter table public.reunioes add column if not exists team text default 'init';
alter table public.reunioes add column if not exists relatorio text default '';
alter table public.reunioes add column if not exists participants jsonb default '[]'::jsonb;
alter table public.reunioes add column if not exists created_at timestamptz default now();
alter table public.reunioes add column if not exists updated_at timestamptz default now();
create index if not exists idx_reunioes_team on public.reunioes(team);
create index if not exists idx_reunioes_status on public.reunioes(status);
create index if not exists idx_reunioes_mes_ano on public.reunioes(mes_ano);
alter table public.reunioes enable row level security;
drop policy if exists "reunioes all" on public.reunioes;
create policy "reunioes all" on public.reunioes for all using (true) with check (true);

-- ============================================================================
-- FIM
-- ============================================================================
