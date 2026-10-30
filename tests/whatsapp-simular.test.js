import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mensagensDoWebhook } from '../supabase/functions/whatsapp/provedor.ts';

const require = createRequire(import.meta.url);
const { lerArgs, montarPayload, urlComToken } = require('../tools/whatsapp-simular.js');

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
  it('gera um ReceivedCallback que o adaptador aceita', () => {
    const p = montarPayload(lerArgs(['--texto', 'oi', '--telefone', '+55 (11) 98765-4321']), 1700000000000);
    const [m] = mensagensDoWebhook(p);
    expect(m.telefone).toBe('5511987654321');
    expect(m.texto).toBe('oi');
    expect(m.quando).toBe(new Date(1700000000000).toISOString());
  });

  it('id novo a cada execução, para não cair na deduplicação', () => {
    const o = lerArgs([]);
    expect(montarPayload(o, 1).messageId).not.toBe(montarPayload(o, 2).messageId);
  });

  it('respeita --id quando o teste é justamente a deduplicação', () => {
    expect(montarPayload(lerArgs(['--id', 'FIXO']), 1).messageId).toBe('FIXO');
  });
});

describe('urlComToken', () => {
  it('põe o token na query sem perder o que já havia', () => {
    const u = new URL(urlComToken('https://x.supabase.co/functions/v1/whatsapp?a=1', 't&k'));
    expect(u.searchParams.get('token')).toBe('t&k');
    expect(u.searchParams.get('a')).toBe('1');
  });
});
