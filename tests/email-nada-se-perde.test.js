import { describe, it, expect } from 'vitest';
import {
  corpoLimpo,
  entradaDaCaixa,
  pendenciaDaTriagem,
  triagemDaIa,
} from '../supabase/functions/robo/campo.ts';

// ── Todo e-mail que chega vira linha na caixa ─────────────────────────────
// A triagem descartava em silêncio o e-mail sem cliente e o que a IA marcou
// `ignorar`. Os dois podem ser pedido de verdade, e some sem rastro é o pior
// defeito possível numa porta de entrada: ninguém descobre que perdeu. Agora
// até o que virou chamado entra, para a caixa mostrar a conversa inteira.

const email = (over = {}) => ({
  id: 'msg-1',
  de: 'Márcia Prado <marcia@acme.com.br>',
  assunto: 'Impressora não imprime',
  data: '2026-10-26T12:00:00.000Z',
  trecho: 'A impressora da recepção parou de imprimir hoje de manhã.',
  message_id: '<CAF=abc@mail.gmail.com>',
  thread_id: 'thread-9',
  ...over,
});
const cliente = { id: 'CLI-1', name: 'Acme', team: 'init', technician: 'Ana' };

describe('a entrada que não virou chamado vira registro', () => {
  it('guarda quem escreveu, o assunto e por que não virou chamado', () => {
    const r = entradaDaCaixa(email(), { motivo: 'sem_cliente' }, 'ETR-1');
    expect(r.email_id).toBe('msg-1');
    expect(r.de).toBe('Márcia Prado <marcia@acme.com.br>');
    expect(r.assunto).toBe('Impressora não imprime');
    expect(r.motivo).toBe('sem_cliente');
  });

  it('nasce pendente e sem chamado ligado', () => {
    const r = entradaDaCaixa(email(), { motivo: 'ignorado_ia' }, 'ETR-2');
    expect(r.status).toBe('pendente');
    expect(r.pendencia_id).toBeNull();
    expect(r.tratado_por).toBeNull();
    expect(r.tratado_em).toBeNull();
  });

  it('guarda o corpo LIMPO, não o e-mail cru', () => {
    // É o que alguém vai ler para decidir em cinco segundos se era chamado.
    const cru = 'Bom dia, a impressora parou.\n\nAtenciosamente,\nMárcia\n(11) 99999-0000\n\n'
      + 'Em qui., 22 de out. de 2026 às 10:30, Suporte <s@init.com> escreveu:\n> alguma novidade?';
    const r = entradaDaCaixa(email({ trecho: cru }), { motivo: 'sem_cliente' }, 'ETR-3');
    expect(r.corpo).toContain('a impressora parou');
    expect(r.corpo).not.toContain('99999-0000');
    expect(r.corpo).not.toContain('alguma novidade');
  });

  it('leva a conversa junto, para o chamado futuro casar a thread', () => {
    const r = entradaDaCaixa(email(), { motivo: 'sem_cliente' }, 'ETR-4');
    expect(r.thread_id).toBe('thread-9');
    expect(r.message_id).toBe('<CAF=abc@mail.gmail.com>');
  });

  it('e-mail sem thread não inventa id vazio', () => {
    const r = entradaDaCaixa(email({ thread_id: '', message_id: null }), { motivo: 'sem_cliente' }, 'ETR-5');
    expect(r.thread_id).toBeNull();
    expect(r.message_id).toBeNull();
  });

  it('data inválida cai para agora, em vez de gravar lixo', () => {
    const agora = new Date('2026-10-26T15:00:00.000Z');
    const r = entradaDaCaixa(email({ data: 'ontem' }), { motivo: 'sem_cliente', team: 'init' }, 'ETR-6', agora);
    expect(r.recebido_em).toBe('2026-10-26T15:00:00.000Z');
  });

  it('a data do e-mail vale quando dá para ler', () => {
    const r = entradaDaCaixa(email(), { motivo: 'sem_cliente', team: 'init' }, 'ETR-7', new Date('2026-10-26T15:00:00.000Z'));
    expect(r.recebido_em).toBe('2026-10-26T12:00:00.000Z');
  });

  it('equipe vazia cai no padrão, porque a coluna é NOT NULL', () => {
    expect(entradaDaCaixa(email(), { motivo: 'sem_cliente', team: '' }, 'ETR-8').team).toBe('init');
  });

  it('corpo vazio vira null, não string vazia', () => {
    expect(entradaDaCaixa(email({ trecho: '   ' }), { motivo: 'sem_cliente' }, 'ETR-9').corpo).toBeNull();
  });

  it('assunto gigante é cortado antes de bater no banco', () => {
    const r = entradaDaCaixa(email({ assunto: 'x'.repeat(500) }), { motivo: 'sem_cliente' }, 'ETR-10');
    expect(r.assunto).toHaveLength(300);
  });
});

describe('o que o robô já resolveu também entra na caixa', () => {
  const agora = new Date('2026-10-26T15:00:00.000Z');

  it('e-mail que virou chamado entra resolvido pelo robô e ligado ao chamado', () => {
    const r = entradaDaCaixa(email(), { status: 'virou_chamado', pendenciaId: 'PEN-1', clientId: 'CLI-1', team: 'init' }, 'ETR-11', agora);
    expect(r.status).toBe('virou_chamado');
    expect(r.pendencia_id).toBe('PEN-1');
    expect(r.client_id).toBe('CLI-1');
    expect(r.tratado_por).toBe('robo');
    expect(r.tratado_em).toBe('2026-10-26T15:00:00.000Z');
  });

  it('resposta anexada ao chamado aberto entra como anexado', () => {
    const r = entradaDaCaixa(email(), { status: 'anexado', pendenciaId: 'PEN-2', clientId: 'CLI-1' }, 'ETR-12', agora);
    expect(r.status).toBe('anexado');
    expect(r.pendencia_id).toBe('PEN-2');
    expect(r.tratado_por).toBe('robo');
  });

  it('linha resolvida não precisa de motivo', () => {
    // O motivo explica por que NÃO virou chamado; a 073 tirou o NOT NULL.
    const r = entradaDaCaixa(email(), { status: 'virou_chamado', pendenciaId: 'PEN-3' }, 'ETR-13');
    expect(r.motivo).toBeNull();
  });

  it('pendente sem cliente fica sem client_id, e não com string vazia', () => {
    expect(entradaDaCaixa(email(), { motivo: 'sem_cliente', clientId: '' }, 'ETR-14').client_id).toBeNull();
  });
});

describe('o chamado guarda o e-mail inteiro', () => {
  it('email_corpo tem o texto todo, mesmo com a descrição cortada em 600', () => {
    // O corte de 600 é o que fazia a descrição terminar no meio da frase, e o
    // resto não existia em lugar nenhum — tinha de ir buscar no Gmail.
    const longo = 'Bom dia. ' + 'Detalhe do problema. '.repeat(80);
    const e = email({ trecho: longo });
    const pen = pendenciaDaTriagem(triagemDaIa('', e), e, cliente, 'PEN-1');
    expect(pen.email_corpo.length).toBeGreaterThan(600);
    expect(pen.email_corpo).toBe(corpoLimpo(longo).slice(0, 20000));
  });

  it('o corpo guardado é o limpo: sem citação nem assinatura', () => {
    // O texto precisa ser longo o bastante: corpoLimpo devolve o ORIGINAL
    // quando o corte deixaria menos de 20 caracteres, para um e-mail de duas
    // linhas não virar chamado vazio.
    const cru = 'A impressora da recepção parou de imprimir hoje de manhã.\n\nAtt,\nMárcia\n(11) 99999-0000\n\nEm qui., 22 de out. de 2026 às 10:30, X <x@y.com> escreveu:\n> oi';
    const e = email({ trecho: cru });
    const pen = pendenciaDaTriagem(triagemDaIa('', e), e, cliente, 'PEN-2');
    expect(pen.email_corpo).toContain('parou de imprimir');
    expect(pen.email_corpo).not.toContain('99999-0000');
    expect(pen.email_corpo).not.toContain('escreveu:');
  });

  it('e-mail sem texto não grava string vazia', () => {
    const pen = pendenciaDaTriagem(triagemDaIa('', email({ trecho: '' })), email({ trecho: '' }), cliente, 'PEN-3');
    expect(pen.email_corpo).toBeNull();
  });

  it('o teto de 20 mil caracteres é respeitado', () => {
    const e = email({ trecho: 'a'.repeat(30000) });
    const pen = pendenciaDaTriagem(triagemDaIa('', e), e, cliente, 'PEN-4');
    expect(pen.email_corpo).toHaveLength(20000);
  });

  it('o resto do chamado não muda', () => {
    // A coluna é nova (066): banco sem ela não pode mudar nada do que já havia.
    const e = email();
    const pen = pendenciaDaTriagem(triagemDaIa('', e), e, cliente, 'PEN-5');
    expect(pen.canal).toBe('email');
    expect(pen.client_id).toBe('CLI-1');
    expect(pen.solicitante_email).toBe('marcia@acme.com.br');
    expect(pen.email_thread_id).toBe('thread-9');
  });
});
