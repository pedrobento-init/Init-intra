import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { respostaAutomatica, entradaDaCaixa } from '../supabase/functions/robo/campo.ts';

// ── Resposta automática não vira nota no chamado ──────────────────────────
// A auto-resposta do cliente ("estou de férias") caía na conversa e virava
// nota do solicitante. Pior: a nossa resposta gerava outra auto-resposta, que
// virava outra nota. A triagem agora separa a máquina antes de olhar a conversa.

const ler = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const email = (over = {}) => ({
  id: 'msg-1',
  de: 'Márcia Prado <marcia@acme.com.br>',
  assunto: 'Re: Impressora não imprime',
  data: '2026-10-26T12:00:00.000Z',
  trecho: 'Voltou a imprimir, obrigada!',
  message_id: '<CAF=abc@mail.gmail.com>',
  thread_id: 'thread-9',
  ...over,
});

describe('o cabeçalho manda primeiro', () => {
  it('Auto-Submitted: auto-replied é máquina (RFC 3834)', () => {
    expect(respostaAutomatica(email({ cabecalhos: { 'Auto-Submitted': 'auto-replied' } }))).toBe(true);
  });

  it('Auto-Submitted: no é gente — o servidor afirmou que não é automático', () => {
    expect(respostaAutomatica(email({ cabecalhos: { 'Auto-Submitted': 'no' } }))).toBe(false);
  });

  it('o nome do cabeçalho não depende de maiúscula', () => {
    expect(respostaAutomatica(email({ cabecalhos: { 'x-autoreply': 'yes' } }))).toBe(true);
  });

  it('Precedence: bulk e auto_reply são máquina', () => {
    expect(respostaAutomatica(email({ cabecalhos: { Precedence: 'bulk' } }))).toBe(true);
    expect(respostaAutomatica(email({ cabecalhos: { Precedence: 'auto_reply' } }))).toBe(true);
  });

  it('Precedence: list fica de fora — lista de discussão é gente escrevendo', () => {
    expect(respostaAutomatica(email({ cabecalhos: { Precedence: 'list' } }))).toBe(false);
  });

  it('cabeçalho vazio, como o Apps Script manda quando não existe, não conta', () => {
    const vazios = { 'Auto-Submitted': '', 'X-Autoreply': '', 'X-Autorespond': '', Precedence: '' };
    expect(respostaAutomatica(email({ cabecalhos: vazios }))).toBe(false);
  });

  it('cabecalhos estranho (texto, null) não derruba a triagem', () => {
    expect(respostaAutomatica(email({ cabecalhos: null }))).toBe(false);
    expect(respostaAutomatica(email({ cabecalhos: 'Auto-Submitted: auto-replied' }))).toBe(false);
  });
});

describe('sem cabeçalho, remetente, assunto e corpo cobrem', () => {
  it('aviso de não entrega do mailer-daemon é máquina', () => {
    expect(respostaAutomatica(email({ de: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }))).toBe(true);
  });

  it('assunto de férias com acento e maiúscula é reconhecido', () => {
    expect(respostaAutomatica(email({ assunto: 'Resposta Automática: Re: Impressora' }))).toBe(true);
    expect(respostaAutomatica(email({ assunto: 'Out of Office: Impressora' }))).toBe(true);
  });

  it('corpo que se declara automático é reconhecido', () => {
    expect(respostaAutomatica(email({ trecho: 'Esta é uma resposta automática. Retorno dia 3.' }))).toBe(true);
  });

  it('e-mail comum de cliente segue para a conversa', () => {
    expect(respostaAutomatica(email())).toBe(false);
  });

  it('a palavra "automática" no meio do pedido não basta', () => {
    expect(respostaAutomatica(email({ trecho: 'A atualização automática do Windows travou o computador.' }))).toBe(false);
  });
});

describe('a auto-resposta não some: vai para a caixa de triagem', () => {
  it('vira entrada com motivo auto_resposta', () => {
    expect(entradaDaCaixa(email(), { motivo: 'auto_resposta' }, 'ETR-1').motivo).toBe('auto_resposta');
  });

  it('o robô separa a máquina antes de olhar a conversa do chamado', () => {
    const robo = ler('../supabase/functions/robo/index.ts');
    const detecta = robo.indexOf('if (respostaAutomatica(e))');
    expect(detecta).toBeGreaterThan(-1);
    expect(robo.slice(detecta, detecta + 300)).toContain('"auto_resposta"');
    // Depois da conversa seria tarde: a auto-resposta já teria virado nota.
    expect(detecta).toBeLessThan(robo.indexOf('await chamadoDaConversa(db, e.thread_id'));
  });

  it('a migration 070 libera o motivo novo no CHECK e traz como reverter', () => {
    const migr = ler('../supabase/migrations/070_emails_triagem_auto_resposta.sql');
    expect(migr).toContain("'auto_resposta'");
    expect(migr).toContain('VERIFICAR:');
    expect(migr).toContain('REVERTER');
  });

  it('a tela tem rótulo para o motivo novo — sem ele o card mostraria o código cru', () => {
    expect(ler('../js/emails-triagem.js')).toMatch(/auto_resposta:\s*\{\s*label:/);
  });

  it('o Apps Script manda os cabeçalhos que a detecção lê', () => {
    const gs = ler('../tools/google-agenda-apps-script/Robo.gs');
    expect(gs).toContain("m.getHeader('Auto-Submitted')");
    expect(gs).toContain("everyMinutes(5)");
  });
});
