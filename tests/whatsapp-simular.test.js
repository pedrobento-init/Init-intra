import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mensagensDoWebhook } from '../supabase/functions/whatsapp/provedor.ts';

const require = createRequire(import.meta.url);
const { lerArgs, montarPayload, principal } = require('../tools/whatsapp-simular.js');

// O simulador só serve se o payload dele passar pelo mesmo adaptador que o
// webhook usa; se um mudar sem o outro, o teste manual mente.

describe('lerArgs', () => {
  it('lê as opções e mantém o padrão do resto', () => {
    const o = lerArgs(['--texto', 'oi', '--telefone', '5521999990000', '--mostrar']);
    expect(o.texto).toBe('oi');
    expect(o.telefone).toBe('5521999990000');
    expect(o.mostrar).toBe(true);
    expect(o.nome).toBe('Cliente de teste');
  });

  it('ignora opção desconhecida e opção sem valor', () => {
    const o = lerArgs(['--inventada', 'x', '--url']);
    expect(o.url).toBe('');
    expect('inventada' in o).toBe(false);
  });
});

describe('montarPayload', () => {
  it('gera um messages.upsert que o adaptador aceita', () => {
    const p = montarPayload(lerArgs(['--texto', 'oi', '--telefone', '+55 (11) 98765-4321']), 1700000000000);
    const [m] = mensagensDoWebhook(p);
    expect(m.telefone).toBe('5511987654321');
    expect(m.texto).toBe('oi');
    expect(m.quando).toBe(new Date(1700000000000).toISOString());
    expect(m.id).toMatch(/^SIM/);
  });

  it('id novo a cada execução, para não cair na deduplicação', () => {
    const o = lerArgs([]);
    expect(montarPayload(o, 1).data.key.id).not.toBe(montarPayload(o, 2).data.key.id);
  });

  it('respeita --id quando o teste é justamente a deduplicação', () => {
    expect(montarPayload(lerArgs(['--id', 'FIXO']), 1).data.key.id).toBe('FIXO');
  });
});

describe('principal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // O segredo vai no cabeçalho, como a Evolution manda: na URL ele acabaria
  // no log de quem estiver no caminho.
  it('manda o token no cabeçalho x-whatsapp-secret, não na URL', async () => {
    const chamadas = [];
    vi.stubGlobal('fetch', async (url, init) => {
      chamadas.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const url = 'https://x.supabase.co/functions/v1/whatsapp';
    const code = await principal(['--url', url, '--texto', 'oi'], { WHATSAPP_WEBHOOK_TOKEN: 'segredo' });
    expect(code).toBe(0);
    expect(chamadas[0].url).toBe(url);
    expect(chamadas[0].init.headers['x-whatsapp-secret']).toBe('segredo');
  });
});
