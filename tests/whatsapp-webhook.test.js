import { describe, it, expect, beforeAll } from 'vitest';
import { loadHandler } from './helpers/edge-harness.js';
import { fakeSupabase } from './helpers/fake-supabase.js';

// O webhook roda de verdade (tests/helpers/edge-harness.js) com o dublê de
// Supabase. O que importa aqui não é o formato do evento — isso é do
// whatsapp-provedor.test.js — e sim o que acontece quando a gravação falha e
// para onde a chave da WAHA pode ir.

const ENV = {
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_ANON_KEY: 'anon-de-teste',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste',
  WHATSAPP_WEBHOOK_TOKEN: 'segredo-do-webhook',
  WAHA_BASE_URL: 'https://waha.interno',
  WAHA_API_KEY: 'chave-da-waha',
};

function evento(extra = {}) {
  return {
    event: 'message',
    payload: {
      id: 'MSG1',
      from: '5511987654321@c.us',
      body: 'A impressora parou',
      timestamp: 1700000000,
      notifyName: 'Márcia',
      ...extra,
    },
  };
}

// `falharInsert` derruba todo insert em emails_triagem, que é como o banco se
// comporta quando a gravação não acontece. O Proxy troca só o insert do builder.
async function chamar(payload, { falharInsert = false, fetch } = {}) {
  const queries = [];
  const base = fakeSupabase({ queries });
  const createClient = (url, key, opts) => {
    const cliente = base(url, key, opts);
    const from = cliente.from;
    cliente.from = (tabela) => {
      const b = from(tabela);
      if (!falharInsert || tabela !== 'emails_triagem') return b;
      return new Proxy(b, {
        get(alvo, prop) {
          return prop === 'insert'
            ? () => Promise.resolve({ error: { message: 'insert falhou' } })
            : alvo[prop];
        },
      });
    };
    return cliente;
  };
  const { handler } = await loadHandler('whatsapp', { env: ENV, createClient, fetch });
  const res = await handler(new Request('https://fn.local/?token=segredo-do-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  return { res, dados: await res.json(), queries };
}

describe('whatsapp: mídia e reentrega', () => {
  // O esbuild da function é o primeiro trabalho pesado do arquivo. Numa suíte
  // inteira ele pode passar dos 5 s padrão do teste; aquecer aqui deixa o
  // timeout do teste medindo o handler, não o bundler.
  beforeAll(async () => {
    await loadHandler('whatsapp', { env: ENV, createClient: () => ({}) });
  }, 60000);

  // O anexo da WAHA vem como URL. `//host` no pathname resolvia como URL
  // protocol-relative: o download ia para o host do atacante levando a
  // X-Api-Key no cabeçalho.
  it('anexo com host embutido no caminho não manda a chave para fora da WAHA', async () => {
    const buscadas = [];
    const { res } = await chamar(evento({
      body: '',
      hasMedia: true,
      media: { url: 'https://x//evil.example.com/roubar', filename: 'a.png', mimetype: 'image/png' },
    }), {
      fetch: async (url) => {
        buscadas.push(String(url));
        return new Response('não é imagem', { status: 404 });
      },
    });
    expect(res.status).toBe(200);
    expect(buscadas).toHaveLength(1);
    expect(new URL(buscadas[0]).origin).toBe('https://waha.interno');
  });

  // Sem chamado aberto, a caixa é o único destino da mensagem. Se o insert
  // falha, a chave de dedupe tem que voltar e a function responder 500: assim a
  // reentrega da WAHA tenta de novo em vez de a mensagem sumir.
  it('insert na caixa que falha devolve a chave de dedupe e responde 500', async () => {
    const { res, dados, queries } = await chamar(evento(), { falharInsert: true });
    expect(res.status).toBe(500);
    expect(dados.ok).toBe(false);
    const devolveu = queries.find((q) =>
      q.tabela === 'avisos_enviados' && !q.insert && q.filtros.some(([col, val]) => col === 'key' && val === 'whatsapp:MSG1'));
    expect(devolveu).toBeDefined();
  });

  it('mensagem que entra na caixa mantém a chave e responde 200', async () => {
    const { res, dados, queries } = await chamar(evento());
    expect(res.status).toBe(200);
    expect(dados).toMatchObject({ ok: true, caixa: 1 });
    const devolveu = queries.find((q) =>
      q.tabela === 'avisos_enviados' && !q.insert && q.filtros.some(([col]) => col === 'key'));
    expect(devolveu).toBeUndefined();
  });
});
