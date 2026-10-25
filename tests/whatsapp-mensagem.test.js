import { describe, it, expect } from 'vitest';
import {
  assinaturaValida,
  assuntoDaMensagem,
  chaveTelefone,
  clienteDoTelefone,
  entradaDaMensagem,
  mensagensDoWebhook,
  pendenciaDoWhatsapp,
  tempoConstante,
  triagemDaMensagem,
} from '../supabase/functions/whatsapp/mensagem.ts';

// Entrada de chamado por WhatsApp. O webhook da Meta entrega muita coisa que
// NÃO é mensagem de gente, e a assinatura é a única autenticação que a função
// tem — é aqui que um descuido vira chamado fantasma ou porta aberta.

/** Envelope da Meta com uma mensagem de texto. */
const webhook = (msg = {}, contato = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA-1',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        contacts: [{ wa_id: '5511999990000', profile: { name: 'Beatriz Rangel' }, ...contato }],
        messages: [{
          from: '5511999990000', id: 'wamid.ABC', timestamp: '1792900000',
          type: 'text', text: { body: 'O notebook não liga mais.' }, ...msg,
        }],
      },
    }],
  }],
});

describe('o que o webhook entrega e não é mensagem', () => {
  it('mensagem de texto atravessa com nome, telefone e data', () => {
    const [m] = mensagensDoWebhook(webhook());
    expect(m.id).toBe('wamid.ABC');
    expect(m.waId).toBe('5511999990000');
    expect(m.nome).toBe('Beatriz Rangel');
    expect(m.texto).toBe('O notebook não liga mais.');
  });

  it('o timestamp é epoch em SEGUNDOS, não em milissegundos', () => {
    // Tratar como ms jogaria a data para o ano 56000 e levaria o SLA junto.
    const [m] = mensagensDoWebhook(webhook({ timestamp: '1792900000' }));
    expect(m.data).toBe(new Date(1792900000 * 1000).toISOString());
    expect(new Date(m.data).getUTCFullYear()).toBeLessThan(2100);
  });

  it('recibo de entrega e de leitura não vira chamado', () => {
    const recibo = {
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
    };
    expect(mensagensDoWebhook(recibo)).toEqual([]);
  });

  it('áudio e imagem ficam de fora: virariam chamado sem texto nenhum', () => {
    expect(mensagensDoWebhook(webhook({ type: 'audio', text: undefined }))).toEqual([]);
    expect(mensagensDoWebhook(webhook({ type: 'image', text: undefined }))).toEqual([]);
  });

  it('mensagem de texto vazia não passa', () => {
    expect(mensagensDoWebhook(webhook({ text: { body: '   ' } }))).toEqual([]);
  });

  it('payload torto não explode, devolve lista vazia', () => {
    expect(mensagensDoWebhook(null)).toEqual([]);
    expect(mensagensDoWebhook({})).toEqual([]);
    expect(mensagensDoWebhook({ entry: 'nada disso' })).toEqual([]);
    expect(mensagensDoWebhook({ entry: [{ changes: [{}] }] })).toEqual([]);
  });

  it('sem nome no perfil, segue sem nome em vez de inventar', () => {
    const [m] = mensagensDoWebhook(webhook({}, { profile: {} }));
    expect(m.nome).toBe('');
  });
});

describe('assinatura: a única autenticação que a função tem', () => {
  const segredo = 'app-secret-de-teste';
  const corpo = JSON.stringify(webhook());

  /** Mesmo HMAC que a Meta faz, para o teste não repetir a implementação. */
  async function assinar(texto, chave) {
    const { createHmac } = await import('node:crypto');
    return 'sha256=' + createHmac('sha256', chave).update(texto).digest('hex');
  }

  it('assinatura certa passa', async () => {
    expect(await assinaturaValida(corpo, await assinar(corpo, segredo), segredo)).toBe(true);
  });

  it('corpo alterado reprova — é o ataque que isto existe para barrar', async () => {
    const sig = await assinar(corpo, segredo);
    const forjado = corpo.replace('não liga mais', 'não liga MAIS');
    expect(await assinaturaValida(forjado, sig, segredo)).toBe(false);
  });

  it('segredo errado reprova', async () => {
    expect(await assinaturaValida(corpo, await assinar(corpo, 'outro'), segredo)).toBe(false);
  });

  it('sem header, sem prefixo ou sem segredo configurado, reprova', async () => {
    const sig = await assinar(corpo, segredo);
    expect(await assinaturaValida(corpo, null, segredo)).toBe(false);
    expect(await assinaturaValida(corpo, sig.replace('sha256=', ''), segredo)).toBe(false);
    expect(await assinaturaValida(corpo, sig, '')).toBe(false);
  });

  it('a comparação não para no primeiro byte diferente', () => {
    // Parar cedo revela, pelo tempo, quantos bytes batem — e isso basta para
    // montar a assinatura byte a byte.
    expect(tempoConstante('abc', 'abc')).toBe(true);
    expect(tempoConstante('abc', 'abd')).toBe(false);
    expect(tempoConstante('abc', 'abcd')).toBe(false);
    expect(tempoConstante('', '')).toBe(true);
  });
});

describe('achar o cliente pelo telefone', () => {
  const clientes = [
    { id: 'C1', name: 'Dias Rizzo', team: 'init', technician: 'Ana', owner_phone: '(11) 99999-0000' },
    { id: 'C2', name: 'Acme', team: 'init', technician: 'Beto', responsible_phone: '+55 21 98888-1111' },
  ];

  it('casa o wa_id com o telefone da ficha, formato diferente e tudo', () => {
    expect(clienteDoTelefone(clientes, '5511999990000').id).toBe('C1');
    expect(clienteDoTelefone(clientes, '5521988881111').id).toBe('C2');
  });

  it('cadastro antigo sem o nono dígito ainda casa', () => {
    // "(11) 9999-0000" é o mesmo número de antes do nono dígito.
    const antigo = [{ id: 'C3', name: 'Velho', owner_phone: '(11) 9999-0000' }];
    expect(clienteDoTelefone(antigo, '5511999990000').id).toBe('C3');
  });

  it('telefone de outro cliente não casa', () => {
    expect(clienteDoTelefone(clientes, '5511888887777')).toBe(null);
  });

  it('número sem DDD não casa com ninguém, em vez de casar com qualquer um', () => {
    expect(chaveTelefone('99990000')).toBe('');
    expect(clienteDoTelefone(clientes, '99990000')).toBe(null);
  });

  it('lista vazia ou telefone vazio devolve null', () => {
    expect(clienteDoTelefone([], '5511999990000')).toBe(null);
    expect(clienteDoTelefone(clientes, '')).toBe(null);
  });
});

describe('a mensagem vira chamado', () => {
  const m = {
    id: 'wamid.ABC', waId: '5511999990000', nome: 'Beatriz Rangel',
    texto: 'O notebook não liga mais.\nJá tentei trocar a fonte.',
    data: '2026-10-25T13:05:00.000Z',
  };
  const cliente = { id: 'C1', name: 'Dias Rizzo', team: 'init', technician: 'Ana' };

  it('a primeira linha vira o assunto', () => {
    expect(assuntoDaMensagem(m.texto)).toBe('O notebook não liga mais.');
  });

  it('linha longa demais é cortada com reticências', () => {
    const longa = 'a'.repeat(200);
    expect(assuntoDaMensagem(longa).length).toBe(118);
    expect(assuntoDaMensagem(longa).endsWith('…')).toBe(true);
  });

  it('mensagem só com quebras de linha não vira assunto vazio', () => {
    expect(assuntoDaMensagem('\n\n  \n')).toBe('Pedido por WhatsApp');
  });

  it('sem IA, a descrição é a mensagem e o canal é whatsapp', () => {
    const t = triagemDaMensagem('Accepted', m);
    const p = pendenciaDoWhatsapp(t, m, cliente, 'PEN-W1', new Date('2026-10-25T13:06:00Z'));
    expect(p.canal).toBe('whatsapp');
    expect(p.descricao).toContain('O notebook não liga mais.');
    expect(p.descricao).toContain('Aberta pela triagem de WhatsApp');
    expect(p.client_id).toBe('C1');
    expect(p.responsible).toBe('Ana');
  });

  it('o solicitante é o nome do perfil, nunca o telefone', () => {
    expect(triagemDaMensagem('Accepted', m).solicitante).toBe('Beatriz Rangel');
    const semNome = triagemDaMensagem('Accepted', { ...m, nome: '' });
    expect(semNome.solicitante).toBe('Contato de WhatsApp');
    expect(semNome.solicitante).not.toContain('5511');
  });

  it('não promete responder por e-mail para quem escreveu no WhatsApp', () => {
    const p = pendenciaDoWhatsapp(triagemDaMensagem('Accepted', m), m, cliente, 'PEN-W2');
    expect(p.solicitante_email).toBe(null);
    expect(p.email_message_id).toBe(null);
  });

  it('a conversa é guardada com prefixo de canal, para casar a próxima mensagem', () => {
    const p = pendenciaDoWhatsapp(triagemDaMensagem('Accepted', m), m, cliente, 'PEN-W3');
    expect(p.email_thread_id).toBe('whatsapp:5511999990000');
  });

  it('a classificação da IA passa pelas mesmas listas fechadas do e-mail', () => {
    const t = triagemDaMensagem(JSON.stringify({ categoria: 'nuvem', tipo: 'Urgência', prioridade: 'critica' }), m);
    expect(t.categoria).toBe('outro');   // "nuvem" não existe na lista
    expect(t.tipo).toBe('Suporte');      // "Urgência" não existe na lista
    expect(t.prioridade).toBe('alta');   // crítica é teto da equipe, não da triagem
  });

  it('a mensagem chega à IA já limpa de citação', () => {
    const comCitacao = { ...m, texto: 'Continua sem acesso.\n\n> Pode testar agora?' };
    expect(entradaDaMensagem(comCitacao).trecho).toBe('Continua sem acesso.');
  });

  it('a tag diz de onde veio, para dar para filtrar depois', () => {
    const p = pendenciaDoWhatsapp(triagemDaMensagem('Accepted', m), m, cliente, 'PEN-W4');
    expect(p.tags).toContain('whatsapp');
    expect(p.tags).toContain('triagem-automatica');
  });
});
