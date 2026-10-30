import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// js/chamado-canal.js é modo script: roda num sandbox com só o que ele usa do
// resto do app, para o teste não depender da ordem do index.html.
const FONTE = fs.readFileSync('js/chamado-canal.js', 'utf8');

let s, toasts, chamadas, resposta, conectado, logs;

function carregar() {
  const sandbox = {
    console,
    window: { _supabaseAuthActive: true },
    isSupabaseConnected: () => conectado,
    showToast: (m, t) => toasts.push([m, t]),
    _logSilent: (e, ctx) => logs.push([e, ctx]),
    supabaseClient: {
      functions: {
        invoke: (nome, opts) => {
          chamadas.push([nome, opts]);
          return typeof resposta === 'function' ? resposta() : Promise.resolve(resposta);
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(FONTE, sandbox);
  return sandbox;
}

beforeEach(() => {
  toasts = [];
  chamadas = [];
  logs = [];
  conectado = true;
  resposta = { data: { success: true, to: '5511987654321' } };
  s = carregar();
});

describe('canal do chamado', () => {
  it('canal whatsapp na pendência é WhatsApp', () => {
    expect(s.chamadoCanalDe({ canal: 'whatsapp' })).toBe('whatsapp');
  });

  it('thread id com prefixo whatsapp: basta, mesmo sem a coluna canal', () => {
    expect(s.chamadoCanalDe({ emailThreadId: 'whatsapp:5511987654321' })).toBe('whatsapp');
  });

  it('lê também a linha crua do Supabase, em snake_case', () => {
    expect(s.chamadoCanalDe({ email_thread_id: 'whatsapp:5511987654321' })).toBe('whatsapp');
    expect(s.chamadoCanalDe({ solicitante_email: 'marcia@acme.com.br' })).toBe('email');
  });

  it('chamado com e-mail do solicitante responde por e-mail', () => {
    expect(s.chamadoCanalDe({ solicitanteEmail: 'marcia@acme.com.br', emailThreadId: 'thread-9' })).toBe('email');
  });

  it('chamado aberto à mão, sem e-mail nem telefone, não tem canal', () => {
    expect(s.chamadoCanalDe({ solicitanteEmail: '   ' })).toBeNull();
    expect(s.chamadoCanalDe(null)).toBeNull();
  });

  it('WhatsApp vence o e-mail herdado do cadastro: a pessoa espera a resposta onde falou', () => {
    expect(s.chamadoCanalDe({ canal: 'whatsapp', solicitanteEmail: 'marcia@acme.com.br' })).toBe('whatsapp');
  });

  it('canal desconhecido aparece como "Sem canal"', () => {
    expect(s.chamadoCanalRotulo('whatsapp')).toBe('WhatsApp');
    expect(s.chamadoCanalRotulo('fax')).toBe('Sem canal');
  });

  it('o telefone sai do thread id, e só nos chamados de WhatsApp', () => {
    expect(s.chamadoTelefoneDe({ emailThreadId: 'whatsapp:5511987654321' })).toBe('5511987654321');
    expect(s.chamadoTelefoneDe({ emailThreadId: 'thread-9' })).toBe('');
  });
});

describe('chave e formato do telefone', () => {
  it('com e sem 55, com e sem nono dígito, dão a mesma chave', () => {
    const chaves = ['5511987654321', '11987654321', '(11) 98765-4321', '1187654321', '551187654321'].map(s.chamadoTelefoneChave);
    expect(new Set(chaves)).toEqual(new Set(['1187654321']));
  });

  it('número curto demais não vira chave, para não casar ramal com celular', () => {
    expect(s.chamadoTelefoneChave('98765-4321')).toBe('');
  });

  it('formata celular e fixo, com ou sem o 55', () => {
    expect(s.chamadoTelefoneFormatar('5511987654321')).toBe('(11) 98765-4321');
    expect(s.chamadoTelefoneFormatar('1133334444')).toBe('(11) 3333-4444');
  });

  it('número que não reconhece volta como veio', () => {
    expect(s.chamadoTelefoneFormatar(' +1 555 0100 ')).toBe('+1 555 0100');
  });
});

describe('enviar a resposta pelo canal', () => {
  const whats = { id: 'PEN-1', canal: 'whatsapp', emailThreadId: 'whatsapp:5511987654321' };

  it('chamado de WhatsApp chama o whatsapp-responder com id e texto', async () => {
    await s.chamadoEnviarResposta(whats, 'Já estamos vendo');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0][0]).toBe('whatsapp-responder');
    expect(chamadas[0][1]).toEqual({ body: { pendencia_id: 'PEN-1', text: 'Já estamos vendo' } });
  });

  it('o toast de sucesso mostra o número formatado', async () => {
    await s.chamadoEnviarResposta(whats, 'oi');
    expect(toasts).toEqual([['Mensagem enviada no WhatsApp para (11) 98765-4321.', 'success']]);
  });

  it('chamado de e-mail continua indo pelo pendencia-responder', async () => {
    resposta = { data: { success: true, to: 'marcia@acme.com.br', threaded: true } };
    await s.chamadoEnviarResposta({ id: 'PEN-2', solicitanteEmail: 'marcia@acme.com.br' }, 'oi');
    expect(chamadas[0][0]).toBe('pendencia-responder');
    expect(toasts[0]).toEqual(['E-mail enviado para marcia@acme.com.br.', 'success']);
  });

  it('sem conexão avisa que a nota ficou salva e não chama o servidor', async () => {
    conectado = false;
    await s.chamadoEnviarResposta(whats, 'oi');
    expect(chamadas).toHaveLength(0);
    expect(toasts[0]).toEqual(['A nota foi salva, mas a mensagem não saiu: sem conexão com o servidor.', 'error']);
  });

  it('sessão sem auth ativa conta como offline', async () => {
    s.window._supabaseAuthActive = false;
    await s.chamadoEnviarResposta(whats, 'oi');
    expect(chamadas).toHaveLength(0);
  });

  it('erro devolvido pela função aparece no toast', async () => {
    resposta = { data: { success: false, error: 'número sem WhatsApp' } };
    await s.chamadoEnviarResposta(whats, 'oi');
    expect(toasts[0]).toEqual(['A nota foi salva, mas a mensagem não saiu: número sem WhatsApp', 'error']);
  });

  it('erro de transporte usa a mensagem do cliente do Supabase', async () => {
    resposta = { data: null, error: { message: 'Failed to fetch' } };
    await s.chamadoEnviarResposta(whats, 'oi');
    expect(toasts[0]).toEqual(['A nota foi salva, mas a mensagem não saiu: Failed to fetch', 'error']);
  });

  it('promise rejeitada vira toast genérico e log silencioso, sem estourar', async () => {
    resposta = () => Promise.reject(new Error('boom'));
    await expect(s.chamadoEnviarResposta(whats, 'oi')).resolves.toBeUndefined();
    expect(toasts[0]).toEqual(['A nota foi salva, mas a mensagem não saiu.', 'error']);
    expect(logs[0][1]).toBe('chamado-canal:responder-whatsapp');
  });

  it('chamado sem canal resolve sem chamar nada: a nota fica só no chamado', async () => {
    await expect(s.chamadoEnviarResposta({ id: 'PEN-3' }, 'oi')).resolves.toBeUndefined();
    expect(chamadas).toHaveLength(0);
    expect(toasts).toHaveLength(0);
  });
});
