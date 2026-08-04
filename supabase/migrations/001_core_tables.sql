-- ============================================================
-- Migration 001: Tabelas principais do Init Intra
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

-- 1. CLIENTS
CREATE TABLE IF NOT EXISTS public.clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT DEFAULT '',
  segment TEXT DEFAULT '',
  color TEXT DEFAULT '#1a56db',
  initials TEXT DEFAULT '',
  logo TEXT DEFAULT '',
  logo_shape TEXT DEFAULT 'circle',
  owner TEXT DEFAULT '',
  owner_phone TEXT DEFAULT '',
  responsible TEXT DEFAULT '',
  responsible_phone TEXT DEFAULT '',
  technician TEXT DEFAULT '',
  server JSONB DEFAULT '{}',
  hosting JSONB DEFAULT '{}',
  backup JSONB DEFAULT '{}',
  licenses JSONB DEFAULT '[]',
  emails JSONB DEFAULT '{}',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. PENDENCIAS
CREATE TABLE IF NOT EXISTS public.pendencias (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  client_name TEXT DEFAULT '',
  tipo TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  responsible TEXT DEFAULT '',
  status TEXT DEFAULT 'aberto',
  priority TEXT DEFAULT 'media',
  deadline DATE,
  notes JSONB DEFAULT '[]',
  link_util TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. TICKETS
CREATE TABLE IF NOT EXISTS public.tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  client_name TEXT DEFAULT '',
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'aberto',
  priority TEXT DEFAULT 'media',
  technician TEXT DEFAULT '',
  updates JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. OPERATORS
CREATE TABLE IF NOT EXISTS public.operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT DEFAULT '',
  color TEXT DEFAULT '#1a56db',
  role TEXT DEFAULT 'Técnico',
  phone TEXT DEFAULT '',
  email TEXT,
  pin_hash TEXT,
  pin_salt TEXT,
  auth_user_id UUID,
  is_admin BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. PROCEDURES
CREATE TABLE IF NOT EXISTS public.procedures (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  title TEXT DEFAULT '',
  category TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. AUDIT_LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  operator_name TEXT DEFAULT 'Sistema',
  action TEXT DEFAULT '',
  type TEXT DEFAULT '',
  target_id TEXT,
  details TEXT DEFAULT '',
  timestamp TIMESTAMPTZ DEFAULT now()
);
