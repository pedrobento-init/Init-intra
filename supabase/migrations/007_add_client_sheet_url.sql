-- ============================================================
-- Migration 007: Adiciona campo google_sheet_url à tabela clients
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS google_sheet_url TEXT DEFAULT '';
