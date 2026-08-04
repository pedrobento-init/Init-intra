-- ============================================================
-- Migration 002: Índices para performance
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

-- Clients
CREATE INDEX IF NOT EXISTS idx_clients_name ON public.clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_segment ON public.clients(segment);

-- Pendencias
CREATE INDEX IF NOT EXISTS idx_pendencias_client ON public.pendencias(client_id);
CREATE INDEX IF NOT EXISTS idx_pendencias_status ON public.pendencias(status);
CREATE INDEX IF NOT EXISTS idx_pendencias_priority ON public.pendencias(priority);
CREATE INDEX IF NOT EXISTS idx_pendencias_responsible ON public.pendencias(responsible);

-- Tickets
CREATE INDEX IF NOT EXISTS idx_tickets_client ON public.tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_technician ON public.tickets(technician);

-- Operators
CREATE INDEX IF NOT EXISTS idx_operators_email ON public.operators(email);
CREATE INDEX IF NOT EXISTS idx_operators_role ON public.operators(role);

-- Procedures
CREATE INDEX IF NOT EXISTS idx_procedures_client ON public.procedures(client_id);
CREATE INDEX IF NOT EXISTS idx_procedures_category ON public.procedures(category);

-- Audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_type ON public.audit_logs(type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator ON public.audit_logs(operator_name);
