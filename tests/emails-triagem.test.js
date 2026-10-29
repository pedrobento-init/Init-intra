import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// ── A caixa de entradas de e-mail (066), os oito pontos de articulação ──────
// Duas camadas aqui: comportamento de verdade (js/emails-triagem.js num
// sandbox com as dependências aparadas) e travas estruturais no resto da
// ponta — formulário, robo e migration — no mesmo espírito de
// tests/triagem-conversa.test.js: o vitest não roda Deno, e o que dá para
// travar sem executar são os invariantes que impedem a tela de mentir.

let lista = [];
let toasts = [];
let aberturas = [];
let undoCb = null;
let clientes = [];

const sandbox = {
  console,
  window: {},
  document: { getElementById: () => null },
  DB: { EMAILS_TRIAGEM: 'intra_emails_triagem' },
  dbGet: () => lista,
  dbSet: (_k, v) => { lista = v; },
  getUser: () => ({ name: 'Ana' }),
  isSupabaseConnected: () => false,
  filterByTeam: (l) => l,
  showToast: (m, k) => toasts.push({ m, k }),
  openPendenciaForm: (...args) => aberturas.push(args),
  showUndoToast: (_m, cb) => { undoCb = cb; },
  escapeHtml: (s) => String(s == null ? '' : s),
  formatDateTime: (s) => s,
  getClientById: (id) => clientes.find((c) => c.id === id) || null,
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
const _err = console.error;
console.error = () => {};
try {
  vm.runInContext(fs.readFileSync('js/emails-triagem.js', 'utf8'), sandbox, { filename: 'emails-triagem.js' });
} finally {
  console.error = _err;
}

const entrada = (over = {}) => Object.assign({
  id: 'ETR-1',
  de: 'Márcia Prado <marcia@acme.com.br>',
  assunto: 'Impressora não imprime',
  corpo: 'A impressora da recepção parou.',
  motivo: 'sem_cliente',
  status: 'pendente',
  pendenciaId: null,
  threadId: 'thread-9',
  messageId: '<CAF=abc@mail.gmail.com>',
  team: 'init',
  recebidoEm: '2026-10-26T12:00:00.000Z',
  tratadoPor: null,
  tratadoEm: null,
  updatedAt: '2026-10-26T12:00:00.000Z',
}, over);

beforeEach(() => { lista = []; toasts = []; aberturas = []; undoCb = null; clientes = []; });

describe('abrir o formulário a partir da caixa', () => {
  it('entrada já tratada não abre nada: card velho não vira segundo chamado', () => {
    lista = [entrada({ status: 'descartado' })];
    sandbox.emailTriagemAbrirChamado('ETR-1');
    expect(aberturas).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].k).toBe('error');
  });

  it('entrada pendente abre com o que o e-mail trouxe, inclusive o id dela', () => {
    lista = [entrada()];
    sandbox.emailTriagemAbrirChamado('ETR-1');
    expect(aberturas).toHaveLength(1);
    const [a, b, c, pre] = aberturas[0];
    expect([a, b, c]).toEqual([null, null, null]);
    expect(pre.etrEntrada).toBe('ETR-1');
    expect(pre.solicitanteEmail).toBe('marcia@acme.com.br');
    expect(pre.emailThreadId).toBe('thread-9');
    expect(pre.emailMessageId).toBe('<CAF=abc@mail.gmail.com>');
    expect(pre.emailCorpo).toBe('A impressora da recepção parou.');
    expect(pre.canal).toBe('email');
    // O id NUNCA fica em window: o cancelar destrói o formulário, e com ele
    // a pendência de marcá-la. Um id solto em window sobrevivia ao cancelar,
    // e o próximo chamado do formulário marcava a entrada errada.
    expect(sandbox.window._emailTriagemPendente).toBeUndefined();
  });
});

describe('fechar o ciclo quando o chamado nasce', () => {
  it('marca virou_chamado com o id vindo do formulário', () => {
    lista = [entrada()];
    sandbox.emailTriagemMarcarAberta('PEN-9', 'ETR-1');
    expect(lista[0].status).toBe('virou_chamado');
    expect(lista[0].pendenciaId).toBe('PEN-9');
    expect(lista[0].tratadoPor).toBe('Ana');
    expect(lista[0].tratadoEm).toBeTruthy();
  });

  it('sem id de entrada (formulário comum) é um no-op', () => {
    lista = [entrada()];
    sandbox.emailTriagemMarcarAberta('PEN-9', '');
    expect(lista[0].status).toBe('pendente');
    expect(lista[0].pendenciaId).toBeNull();
  });

  it('decisão de colega no meio do caminho não é sobrescrita', () => {
    lista = [entrada({ status: 'descartado', tratadoPor: 'Beto' })];
    sandbox.emailTriagemMarcarAberta('PEN-9', 'ETR-1');
    expect(lista[0].status).toBe('descartado');
    expect(lista[0].tratadoPor).toBe('Beto');
    expect(lista[0].pendenciaId).toBeNull();
  });
});

describe('desfazer não deixa responsável fantasma', () => {
  it('descartar grava quem decidiu; o desfazer volta a pendente sem nome nem data', () => {
    lista = [entrada()];
    sandbox.emailTriagemDescartar('ETR-1');
    expect(lista[0].status).toBe('descartado');
    expect(lista[0].tratadoPor).toBe('Ana');
    expect(lista[0].tratadoEm).toBeTruthy();

    expect(typeof undoCb).toBe('function');
    undoCb();
    expect(lista[0].status).toBe('pendente');
    // Ninguém decidiu nada ainda: estampar tratadoPor/tratadoEm aqui seria
    // um responsável registrado numa entrada que está de volta na fila.
    expect(lista[0].tratadoPor).toBeNull();
    expect(lista[0].tratadoEm).toBeNull();
    expect(lista[0].pendenciaId).toBeNull();
  });
});

describe('o formulário carrega e persiste o que veio do e-mail', () => {
  const detalhe = fs.readFileSync(fileURLToPath(new URL('../js/pendencias-detalhe.js', import.meta.url)), 'utf8');

  it('os quatro campos entram como hidden: o submit só grava o que é input', () => {
    expect(detalhe).toContain('<input type="hidden" name="\' + f[0] + \'"');
    expect(detalhe).toContain("['solicitanteEmail', 'emailThreadId', 'emailMessageId', 'emailCorpo']");
  });

  it('o id da entrada viaja no formulário e chega ao marcar', () => {
    expect(detalhe).toContain("['etrEntrada', p.etrEntrada]");
    expect(detalhe).toContain("emailTriagemMarcarAberta(data.id, String(fd.get('etrEntrada') || ''), data.clientId)");
  });
});

describe('a caixa acompanha o app em tempo real', () => {
  const migr = fs.readFileSync(fileURLToPath(new URL('../supabase/migrations/067_emails_triagem_realtime.sql', import.meta.url)), 'utf8');
  const schema = fs.readFileSync(fileURLToPath(new URL('../js/schema.js', import.meta.url)), 'utf8');

  it('a tabela entra na publicação supabase_realtime — assinar sozinho não entrega evento', () => {
    expect(migr).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.emails_triagem');
    expect(migr).toContain('VERIFICAR:');
    expect(migr).toContain('ROLLBACK:');
  });

  it('o schema continua marcando a tabela como realtime', () => {
    const bloco = /table: 'emails_triagem',[\s\S]*?\}/.exec(schema);
    expect(bloco).toBeTruthy();
    expect(bloco[0]).toContain('realtime: true');
  });
});

describe('o robô grava a entrada sem reprocessar para sempre', () => {
  const robo = fs.readFileSync(fileURLToPath(new URL('../supabase/functions/robo/index.ts', import.meta.url)), 'utf8');

  it('ignorado_ia herda a equipe do cliente — senão a caixa da mam/bt fica vazia', () => {
    expect(robo).toContain('guardarEntrada(db, e, "ignorado_ia", c.team)');
    expect(robo).toContain('guardarEntrada(db, e, "sem_cliente")');
  });

  it('a chave de dedupe não volta no erro da caixa: era reprocessamento para sempre', () => {
    const trecho = robo.slice(robo.indexOf('async function guardarEntrada'), robo.indexOf('async function triagem'));
    expect(trecho).not.toContain('avisos_enviados');
    expect(trecho).toContain('console.error');
  });
});

describe('aprender o remetente ao vincular cliente', () => {
  it('Gmail aprende o endereço inteiro, nunca o domínio', () => {
    clientes = [{ id: 'C1', team: 'init' }];
    const r = sandbox._emailTriagemAprender('Márcia <Marcia.Prado@Gmail.com>', 'C1');
    expect(r.tipo).toBe('endereco');
    expect(r.remetente).toBe('marcia.prado@gmail.com');
  });
  it('endereço corporativo aprende o domínio', () => {
    clientes = [{ id: 'C1', team: 'init' }];
    const r = sandbox._emailTriagemAprender('Márcia Prado <marcia@acme.com.br>', 'C1');
    expect(r.tipo).toBe('dominio');
    expect(r.remetente).toBe('acme.com.br');
  });
  it('a equipe vem do cliente, não de quem vinculou: a RLS filtra por ela', () => {
    clientes = [{ id: 'C2', team: 'mam' }];
    const r = sandbox._emailTriagemAprender('ti@acme.com.br', 'C2');
    expect(r.team).toBe('mam');
    expect(r.id).toBe('mam|acme.com.br');
  });
  it('sem cliente não aprende nada', () => {
    expect(sandbox._emailTriagemAprender('ti@acme.com.br', 'C-sumiu')).toBeNull();
    expect(sandbox._emailTriagemAprender('ti@acme.com.br', '')).toBeNull();
  });
});
