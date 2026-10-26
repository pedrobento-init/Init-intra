import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guarda estrutural da triagem que casa a conversa (migration 065), no mesmo
// espírito de tests/edge-functions-guard.test.js: o vitest não roda Deno, e o
// que dá para travar aqui são os invariantes que impedem a tela de mentir.

const robo = fs.readFileSync(
  fileURLToPath(new URL('../supabase/functions/robo/index.ts', import.meta.url)), 'utf8');
const detalhe = fs.readFileSync(
  fileURLToPath(new URL('../js/pendencias-detalhe.js', import.meta.url)), 'utf8');
const migration = fs.readFileSync(
  fileURLToPath(new URL('../supabase/migrations/065_pendencias_email_thread.sql', import.meta.url)), 'utf8');
const schema = fs.readFileSync(
  fileURLToPath(new URL('../js/schema.js', import.meta.url)), 'utf8');
const robogs = fs.readFileSync(
  fileURLToPath(new URL('../tools/google-agenda-apps-script/Robo.gs', import.meta.url)), 'utf8');

describe('chamado fechado não recebe a resposta', () => {
  // Resposta depois de concluir é pedido NOVO. Ressuscitar o chamado antigo
  // esconderia o pedido do SLA e da fila de quem atende.
  it('a busca da conversa descarta status fechado', () => {
    expect(robo).toContain('PEN_FECHADOS.includes(String(p.status))');
  });

  it('a lista de fechados é a mesma do resto do app', () => {
    const m = /const PEN_FECHADOS = \[(.+?)\]/s.exec(robo);
    expect(m).toBeTruthy();
    const lista = m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean).sort();
    expect(lista).toEqual(['cancelado', 'concluido', 'fechado', 'resolvido']);
  });
});

describe('a nota nova não pode virar chamado', () => {
  it('casando a conversa, a triagem não insere pendência: ela dá update e segue', () => {
    const trecho = robo.slice(robo.indexOf('const aberto = await chamadoDaConversa'));
    const corpo = trecho.slice(0, trecho.indexOf('const c = clienteDoEmail'));
    expect(corpo).toContain('.from("pendencias").update(');
    expect(corpo).not.toContain('.insert(pen');
    expect(corpo).toContain('continue;');
  });

  it('a chave de dedupe é devolvida quando o update falha, para tentar de novo', () => {
    const trecho = robo.slice(robo.indexOf('const aberto = await chamadoDaConversa'));
    const corpo = trecho.slice(0, trecho.indexOf('const c = clienteDoEmail'));
    expect(corpo).toContain('avisos_enviados").delete().eq("key", key)');
  });
});

describe('a fala de quem pediu não lê como anotação interna', () => {
  // 'solicitante' é valor novo: qualquer coisa diferente de 'resposta' caía no
  // ramo de 🔒 interna, e a mensagem do cliente apareceria como segredo da equipe.
  it('o feed separa solicitante de interna', () => {
    expect(detalhe).toContain("var _doSolic = n.visibility === 'solicitante';");
    expect(detalhe).toContain("var _interna = !_doSolic && n.visibility !== 'resposta';");
  });

  it('o selo é o do solicitante, e o de interna não aparece junto', () => {
    expect(detalhe).toContain('feed-tag-solicitante');
    const i = detalhe.indexOf('_doSolic ?');
    const j = detalhe.indexOf('_interna ?', i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i); // os dois ramos são exclusivos, na ordem
  });
});

describe('a coluna nova segue o padrão das outras', () => {
  it('a migration é idempotente e traz como verificar e reverter', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS email_thread_id');
    expect(migration).toContain('VERIFICAR:');
    expect(migration).toContain('ROLLBACK:');
  });

  it('o índice é parcial: chamado aberto à mão não paga por ele', () => {
    expect(migration).toContain('WHERE email_thread_id IS NOT NULL');
  });

  it('é optionalField: banco sem a 065 continua abrindo chamado como antes', () => {
    expect(schema).toContain("'email_thread_id'");
    // Há optionalFields de várias entidades: vale o bloco de pendências, que
    // é o que tem o email_message_id da 064.
    const blocos = [...schema.matchAll(/optionalFields: \[(.+?)\]/gs)].map((b) => b[1]);
    const pendencias = blocos.find((b) => b.includes('email_message_id'));
    expect(pendencias).toContain('email_thread_id');
  });

  it('o Robo.gs manda o id da CONVERSA, não o da mensagem', () => {
    expect(robogs).toContain('thread_id: th.getId()');
    expect(robogs).toContain("message_id: m.getHeader('Message-ID')");
  });
});
