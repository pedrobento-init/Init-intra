-- ============================================================
-- Migration 079: "Visto" na linha do tempo do chamado
-- ============================================================
-- A linha do tempo (063) contava o que a equipe fez, mas não respondia "o
-- responsável já viu?". Entre o chamado chegar e alguém responder, não havia
-- como saber se ele estava parado na fila ou já tinha sido lido.
--
-- O que muda:
--   * marcar_chamado_visto(p_id): grava em `events` um { at, by, by_id,
--     type: 'visto' } na primeira vez que o RESPONSÁVEL abre o chamado. Uma vez
--     por pessoa: se o chamado passa para outro, a primeira abertura do novo
--     responsável também entra.
--
-- Por que RPC, e não o app regravando `events`: o app sobe o array inteiro, e
-- uma cópia velha no aparelho apagaria um evento que o banco acabou de somar
-- (o "Cliente respondeu" da 078, por exemplo). Aqui a soma é um UPDATE só.
-- E quem viu sai do login (current_op_id), não de um nome mandado pelo app.
--
-- "Recebido" não precisa de nada no banco: é a primeira atribuição, que já
-- está em `responsible` + o evento 'responsavel' (063). O app deriva.
--
-- Atualiza updated_at para o sync (LWW por updated_at) levar o evento aos
-- outros aparelhos. 'visto' NÃO conta como interação na regra de 7 dias da
-- 078: abrir o chamado não é atender.
--
-- RLS: nenhuma policy nova. A função é SECURITY INVOKER: o UPDATE passa pelo
-- pens_update (equipe e trava de Gestão) de quem chamou. Só authenticated
-- executa.
--
-- Depende de: 049 (responsible_id), 063 (events), 078 (chamado_com_evento).
--
-- Idempotente.
--
-- VERIFICAR:
--   select has_function_privilege('authenticated', 'public.marcar_chamado_visto(text)', 'execute');  -- true
--   select has_function_privilege('anon', 'public.marcar_chamado_visto(text)', 'execute');           -- false
--
-- REVERTER (o app segue funcionando; só para de registrar "Visto"):
--   drop function if exists public.marcar_chamado_visto(text);
-- ============================================================

create or replace function public.marcar_chamado_visto(p_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  op_id text := public.current_op_id();
  op_nome text := public.current_op_name();
  agora timestamptz := now();
  evento jsonb;
  resultado jsonb;
begin
  if op_id is null then return null; end if;

  evento := jsonb_build_object(
    'at', to_char(agora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'by', coalesce(op_nome, ''), 'by_id', op_id, 'type', 'visto');

  update public.pendencias p
     set events = public.chamado_com_evento(p.events, evento),
         updated_at = agora
   where p.id = p_id
     and p.responsible_id = op_id
     and not exists (
       select 1
         from jsonb_array_elements(case when jsonb_typeof(p.events) = 'array' then p.events else '[]'::jsonb end) e
        where e->>'type' = 'visto' and e->>'by_id' = op_id)
  returning jsonb_build_object('events', p.events, 'updated_at', p.updated_at) into resultado;

  -- null = nada gravado (não é o responsável, já tinha visto, ou o RLS barrou).
  return resultado;
end $$;

revoke all on function public.marcar_chamado_visto(text) from public, anon;
grant execute on function public.marcar_chamado_visto(text) to authenticated;
