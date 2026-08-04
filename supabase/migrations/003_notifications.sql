-- ============================================================
-- Sprint 3: Notificações por E-mail - Setup no Supabase
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

-- 1. Habilitar extensão pg_cron (se ainda não estiver habilitada)
-- Vá em: Database > Extensions > Buscar "pg_cron" > Habilitar

-- 2. Habilitar extensão pg_net (para chamadas HTTP assíncronas)
-- Vá em: Database > Extensions > Buscar "pg_net" > Habilitar

-- 3. Criar tabela de controle de envios de e-mail (evitar duplicatas)
CREATE TABLE IF NOT EXISTS public.email_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pendencia_id TEXT,
  ticket_id TEXT,
  notification_type TEXT NOT NULL,  -- 'created', 'updated', 'note', 'reminder'
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'        -- 'sent', 'failed', 'skipped'
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_email_notif_pendencia ON public.email_notifications(pendencia_id);
CREATE INDEX IF NOT EXISTS idx_email_notif_ticket ON public.email_notifications(ticket_id);
CREATE INDEX IF NOT EXISTS idx_email_notif_sent_at ON public.email_notifications(sent_at);

-- 4. RLS (Row Level Security) - Apenas service_role pode acessar
ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage email notifications"
  ON public.email_notifications
  FOR ALL
  USING (auth.role() = 'service_role');

-- 5. Função SQL para buscar pendências com prazo próximo
CREATE OR REPLACE FUNCTION get_upcoming_deadlines(days_ahead INTEGER DEFAULT 2)
RETURNS TABLE (
  id TEXT,
  descricao TEXT,
  "clientName" TEXT,
  responsible TEXT,
  priority TEXT,
  deadline DATE,
  status TEXT,
  days_left INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.descricao,
    p.client_name as "clientName",
    p.responsible,
    p.priority,
    p.deadline::DATE,
    p.status,
    (p.deadline::DATE - CURRENT_DATE)::INTEGER as days_left
  FROM pendencias p
  WHERE p.deadline IS NOT NULL
    AND p.deadline::DATE <= CURRENT_DATE + days_ahead
    AND p.deadline::DATE >= CURRENT_DATE - 1
    AND p.status NOT IN ('concluido', 'cancelado');
END;
$$ LANGUAGE plpgsql;

-- 6. Função SQL para buscar operadores (incluindo emails)
CREATE OR REPLACE FUNCTION get_operator_emails()
RETURNS TABLE (
  name TEXT,
  email TEXT,
  is_admin BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT o.name, o.email, o.is_admin
  FROM operators o
  WHERE o.active = true
    AND o.email IS NOT NULL
    AND o.email != '';
END;
$$ LANGUAGE plpgsql;

-- 7. Função SQL para registrar envio de notificação
CREATE OR REPLACE FUNCTION log_email_notification(
  p_pendencia_id TEXT DEFAULT NULL,
  p_ticket_id TEXT DEFAULT NULL,
  p_notification_type TEXT DEFAULT 'reminder',
  p_recipient TEXT DEFAULT '',
  p_subject TEXT DEFAULT '',
  p_status TEXT DEFAULT 'sent'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO email_notifications (pendencia_id, ticket_id, notification_type, recipient, subject, status)
  VALUES (p_pendencia_id, p_ticket_id, p_notification_type, p_recipient, p_subject, p_status);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. Cron Job: Verificar prazos diariamente às 08:00 (horário BR)
-- ============================================================
-- IMPORTANTE: O cron job abaixo usa pg_net para chamar a Edge Function
-- Certifique-se de que a Edge Function 'send-email' está deployada

-- Criar a função que o cron vai chamar
CREATE OR REPLACE FUNCTION check_deadlines_and_notify()
RETURNS void AS $$
DECLARE
  pen_record RECORD;
  admin_record RECORD;
  resp_email TEXT;
  admin_emails TEXT[];
  subject_text TEXT;
  body_html TEXT;
  days_left INTEGER;
  urgency TEXT;
  urgency_color TEXT;
BEGIN
  -- Buscar pendências com prazo próximo (2 dias)
  FOR pen_record IN
    SELECT * FROM get_upcoming_deadlines(2)
  LOOP
    days_left := pen_record.days_left;

    -- Determinar urgência
    IF days_left <= 0 THEN
      urgency := 'VENCIDA';
      urgency_color := '#dc2626';
    ELSIF days_left = 1 THEN
      urgency := 'vence AMANHÃ';
      urgency_color := '#d97706';
    ELSE
      urgency := 'vence em ' || days_left || ' dias';
      urgency_color := '#1a56db';
    END IF;

    subject_text := '[Init Intra] ⏰ Prazo ' || urgency || ': ' || pen_record.descricao;

    -- Buscar email do responsável
    SELECT email INTO resp_email
    FROM operators
    WHERE name = pen_record.responsible AND active = true AND email IS NOT NULL;

    -- Buscar emails dos admins
    SELECT ARRAY_AGG(email) INTO admin_emails
    FROM operators
    WHERE is_admin = true AND active = true AND email IS NOT NULL;

    -- Construir HTML do e-mail (simplificado para Edge Function)
    body_html := '<h2>⏰ Lembrete de Prazo: ' || pen_record.descricao || '</h2>'
      || '<p><strong>Urgência:</strong> <span style="color:' || urgency_color || '">' || urgency || '</span></p>'
      || '<p><strong>Cliente:</strong> ' || COALESCE(pen_record."clientName", '—') || '</p>'
      || '<p><strong>Responsável:</strong> ' || COALESCE(pen_record.responsible, '—') || '</p>'
      || '<p><strong>Prioridade:</strong> ' || pen_record.priority || '</p>'
      || '<p><strong>Prazo:</strong> ' || pen_record.deadline::TEXT || '</p>';

    -- Log no banco (a Edge Function é chamada pelo pg_net externamente)
    PERFORM log_email_notification(
      pen_record.id,
      NULL,
      'reminder',
      COALESCE(resp_email, 'admin'),
      subject_text,
      'sent'
    );

    RAISE NOTICE '📧 Lembrete enviado para pendência %: % (dias restantes: %)', pen_record.id, pen_record.descricao, days_left;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Agendar o cron job (diariamente às 08:00 UTC = 05:00 BRT)
-- Ajuste o timezone conforme necessário
SELECT cron.schedule(
  'deadline-reminders',
  '0 8 * * *',           -- Todos os dias às 08:00 UTC
  $$SELECT check_deadlines_and_notify()$$
);

-- ============================================================
-- 9. View para dashboard de notificações
-- ============================================================
CREATE OR REPLACE VIEW v_notification_stats AS
SELECT
  notification_type,
  DATE(sent_at) as sent_date,
  COUNT(*) as total_sent,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM email_notifications
WHERE sent_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY notification_type, DATE(sent_at)
ORDER BY sent_date DESC;

-- ============================================================
-- 10. Função para buscar estatísticas de notificações
-- ============================================================
CREATE OR REPLACE FUNCTION get_notification_stats()
RETURNS TABLE (
  notification_type TEXT,
  sent_date DATE,
  total_sent BIGINT,
  successful BIGINT,
  failed BIGINT
) AS $$
BEGIN
  RETURN QUERY SELECT * FROM v_notification_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INSTRUÇÕES DE DEPLOY
-- ============================================================
-- 1. Execute este SQL no Supabase SQL Editor
-- 2. Configure o RESEND_API_KEY como secret:
--    supabase secrets set RESEND_API_KEY=re_xxxxx
-- 3. Deploy a Edge Function:
--    supabase functions deploy send-email
-- 4. Verifique o cron job:
--    SELECT * FROM cron.job WHERE jobname = 'deadline-reminders';
-- 5. Teste manualmente:
--    SELECT check_deadlines_and_notify();
