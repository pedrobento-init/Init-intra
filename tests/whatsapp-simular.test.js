import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { assinaturaValida, mensagensDoWebhook } from '../supabase/functions/whatsapp/mensagem.ts';

const require = createRequire(import.meta.url);
const { montarPayload, assinar, lerArgs } = require('../tools/whatsapp-simular.js');

// O simulador existe para testar a ponta sem depender da Meta. Isso só vale se
// o payload que ele monta for exatamente o que a function sabe ler — senão ele
// dá "tudo certo" numa coisa que a Meta de verdade não faria. Por isso estes
// testes jogam a saída do simulador no parser e no verificador DE VERDADE, em
// vez de repetir o formato aqui.

describe('o payload do simulador é o que a function lê', () => {
  it('a function enxerga a mensagem que o simulador disse que mandou', () => {
    const payload = montarPayload({
      de: '5511988887777', nome: 'Beatriz Rangel', texto: 'O notebook não liga.',
    });
    const [m] = mensagensDoWebhook(payload);
    expect(m.waId).toBe('5511988887777');
    expect(m.nome).toBe('Beatriz Rangel');
    expect(m.texto).toBe('O notebook não liga.');
  });

  it('o payload padrão, sem argumento nenhum, também é lido', () => {
    expect(mensagensDoWebhook(montarPayload()).length).toBe(1);
  });

  it('telefone com máscara vira só dígitos, como a Meta manda', () => {
    const [m] = mensagensDoWebhook(montarPayload({ de: '+55 (11) 98888-7777' }));
    expect(m.waId).toBe('5511988887777');
  });

  it('a data chega no século certo: o timestamp é em segundos', () => {
    const [m] = mensagensDoWebhook(montarPayload());
    const ano = new Date(m.data).getUTCFullYear();
    expect(ano).toBeGreaterThan(2020);
    expect(ano).toBeLessThan(2100);
  });

  it('mensagem de várias linhas atravessa inteira', () => {
    const texto = 'Primeira linha.\nSegunda linha.';
    const [m] = mensagensDoWebhook(montarPayload({ texto }));
    expect(m.texto).toBe(texto);
  });
});

describe('cada rodada é uma mensagem nova', () => {
  // A function guarda o id em avisos_enviados para não abrir o mesmo chamado
  // duas vezes. Id fixo faria a segunda rodada do teste não fazer nada — e
  // parecer quebrada, que é o pior tipo de falha num script de diagnóstico.
  it('o id da mensagem muda a cada chamada', () => {
    const a = mensagensDoWebhook(montarPayload())[0].id;
    const b = mensagensDoWebhook(montarPayload())[0].id;
    expect(a).not.toBe(b);
  });

  it('dá para fixar o id quando o teste é justamente repetir a mensagem', () => {
    const [m] = mensagensDoWebhook(montarPayload({ id: 'wamid.FIXO' }));
    expect(m.id).toBe('wamid.FIXO');
  });
});

describe('a assinatura do simulador passa no verificador da function', () => {
  const segredo = 'app-secret-de-teste';

  it('corpo assinado pelo simulador é aceito', async () => {
    const corpo = JSON.stringify(montarPayload());
    expect(await assinaturaValida(corpo, assinar(corpo, segredo), segredo)).toBe(true);
  });

  it('assinar com outro segredo é recusado — é o que --assinatura errada faz', async () => {
    const corpo = JSON.stringify(montarPayload());
    expect(await assinaturaValida(corpo, assinar(corpo, segredo + '-errado'), segredo)).toBe(false);
  });

  it('a assinatura é do corpo exato que vai na requisição', async () => {
    // Assinar o objeto e mandar outra serialização é o erro clássico aqui:
    // espaço e ordem de chave mudam os bytes e a assinatura não fecha.
    const payload = montarPayload();
    const corpo = JSON.stringify(payload);
    const sig = assinar(corpo, segredo);
    const outraSerializacao = JSON.stringify(payload, null, 2);
    expect(await assinaturaValida(outraSerializacao, sig, segredo)).toBe(false);
  });
});

describe('leitura dos argumentos da linha de comando', () => {
  it('--chave valor vira par; --flag sozinho vira true', () => {
    expect(lerArgs(['--url', 'https://x', '--verificar'])).toEqual({ url: 'https://x', verificar: true });
  });

  it('flag seguida de outra flag não engole a próxima', () => {
    expect(lerArgs(['--mostrar', '--texto', 'oi'])).toEqual({ mostrar: true, texto: 'oi' });
  });

  it('texto com espaços e acento chega inteiro', () => {
    expect(lerArgs(['--texto', 'não liga mais']).texto).toBe('não liga mais');
  });

  it('o que não é flag é ignorado, sem quebrar', () => {
    expect(lerArgs(['lixo', '--de', '5511999990000'])).toEqual({ de: '5511999990000' });
  });
});
