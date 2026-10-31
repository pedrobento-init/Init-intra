import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TEXTO_MAX,
  assuntoDaMensagem,
  chaveTelefone,
  clienteDoTelefone,
  conversaDoTelefone,
  pendenciaDoWhatsapp,
  telefoneDaConversa,
  telefoneLegivel,
  tempoConstante,
  textoDaResposta,
} from '../supabase/functions/whatsapp/mensagem.ts';

// Regras do canal WhatsApp que independem do provedor. O ponto sensível é a
// chave de conversa: webhook e chamado precisam normalizar o número igual, e
// o whatsapp-responder só pode responder para o número gravado no chamado.

const msg = (extra = {}) => ({
  telefone: '5511987654321',
  nome: 'Maria',
  texto: 'A impressora parou',
  id: 'ABC',
  quando: '2026-10-30T12:00:00.000Z',
  ...extra,
});

const triagem = (extra = {}) => ({
  ignorar: false,
  assunto: 'Impressora parada',
  descricao: 'Cliente relata impressora parada.',
  categoria: 'impressora',
  prioridade: 'media',
  tipo: 'Suporte',
  solicitante: 'Maria',
  semIa: false,
  ...extra,
});

describe('chaveTelefone', () => {
  it('ignora o 55 e a formatação: cadastro e WhatsApp caem na mesma chave', () => {
    expect(chaveTelefone('5511987654321')).toBe(chaveTelefone('(11) 98765-4321'));
  });

  it('casa número antigo sem o nono dígito com o cadastro que tem', () => {
    expect(chaveTelefone('551187654321')).toBe(chaveTelefone('11 98765-4321'));
  });

  it('número curto demais não vira chave, para não casar cliente errado', () => {
    expect(chaveTelefone('98765-4321')).toBe('');
    expect(chaveTelefone(null)).toBe('');
  });
});

describe('clienteDoTelefone', () => {
  const clientes = [
    { id: 'c1', name: 'Padaria', owner_phone: '(21) 3333-4444' },
    { id: 'c2', name: 'Oficina', responsible_phone: '11 98765-4321' },
  ];

  it('acha pelo telefone do responsável', () => {
    expect(clienteDoTelefone(clientes, '5511987654321')?.id).toBe('c2');
  });

  it('número desconhecido não casa ninguém', () => {
    expect(clienteDoTelefone(clientes, '5531999998888')).toBeNull();
  });

  it('dois clientes com o mesmo número não decidem sozinhos: volta null', () => {
    const ambiguos = [...clientes, { id: 'c3', name: 'Mercado', owner_phone: '(11) 98765-4321' }];
    expect(clienteDoTelefone(ambiguos, '5511987654321')).toBeNull();
  });

  it('o mesmo cliente casando pelos dois telefones não é ambiguidade', () => {
    const dobrado = [{ id: 'c4', name: 'Loja', owner_phone: '11 98765-4321', responsible_phone: '(11) 98765-4321' }];
    expect(clienteDoTelefone(dobrado, '5511987654321')?.id).toBe('c4');
  });
});

describe('assuntoDaMensagem', () => {
  it('usa a primeira linha não vazia', () => {
    expect(assuntoDaMensagem('\n  Bom dia  \nsegunda linha')).toBe('Bom dia');
  });

  it('corta linha longa com reticências', () => {
    const a = assuntoDaMensagem('x'.repeat(200));
    expect(a.length).toBe(118);
    expect(a.endsWith('…')).toBe(true);
  });

  it('mensagem vazia ganha um assunto padrão', () => {
    expect(assuntoDaMensagem('   ')).toBe('Pedido por WhatsApp');
  });
});

describe('chave de conversa (email_thread_id)', () => {
  it('ida e volta devolve os dígitos crus', () => {
    const conv = conversaDoTelefone('+55 (11) 98765-4321');
    expect(conv).toBe('whatsapp:5511987654321');
    expect(telefoneDaConversa(conv)).toBe('5511987654321');
  });

  it('thread de e-mail não vira destino de WhatsApp', () => {
    expect(telefoneDaConversa('18c2f0a9b1d2e3f4')).toBe('');
    expect(telefoneDaConversa(null)).toBe('');
  });

  it('número truncado é recusado em vez de enviado', () => {
    expect(telefoneDaConversa('whatsapp:11987654')).toBe('');
    expect(telefoneDaConversa('whatsapp:1234567890123456')).toBe('');
  });

  it('telefone vazio não gera chave (senão todo número sem dígito casaria)', () => {
    expect(conversaDoTelefone('')).toBe('');
  });
});

describe('pendenciaDoWhatsapp', () => {
  const cliente = { id: 'c2', name: 'Oficina', team: 'mam', technician: 'João' };
  const agora = new Date('2026-10-30T12:00:00Z');

  it('grava o número como chave de conversa e o canal whatsapp', () => {
    const p = pendenciaDoWhatsapp(triagem(), msg(), cliente, 'p1', agora);
    expect(p.email_thread_id).toBe('whatsapp:5511987654321');
    expect(p.canal).toBe('whatsapp');
    expect(p.status).toBe('aberto');
  });

  it('herda o team do cliente (RLS por equipe)', () => {
    expect(pendenciaDoWhatsapp(triagem(), msg(), cliente, 'p1', agora).team).toBe('mam');
  });

  it('cliente sem team cai na init, como o resto da triagem', () => {
    expect(pendenciaDoWhatsapp(triagem(), msg(), { id: 'c', name: 'X' }, 'p1', agora).team).toBe('init');
  });

  it('não tem e-mail de solicitante, para a resposta não cair no pendencia-responder', () => {
    expect(pendenciaDoWhatsapp(triagem(), msg(), cliente, 'p1', agora).solicitante_email).toBeNull();
  });

  it('marca as tags da triagem e o fallback sem IA', () => {
    expect(pendenciaDoWhatsapp(triagem(), msg(), cliente, 'p1', agora).tags)
      .toEqual(['triagem-automatica', 'whatsapp']);
    expect(pendenciaDoWhatsapp(triagem({ semIa: true }), msg(), cliente, 'p1', agora).tags)
      .toContain('sem-classificacao-ia');
  });

  it('a chave gravada é a mesma que o webhook procura', () => {
    const p = pendenciaDoWhatsapp(triagem(), msg({ telefone: '55 11 98765-4321' }), cliente, 'p1', agora);
    expect(p.email_thread_id).toBe(conversaDoTelefone('5511987654321'));
  });
});

describe('utilitários', () => {
  it('tempoConstante compara token sem aceitar prefixo', () => {
    expect(tempoConstante('abc123', 'abc123')).toBe(true);
    expect(tempoConstante('abc123', 'abc124')).toBe(false);
    expect(tempoConstante('abc', 'abc123')).toBe(false);
  });

  it('textoDaResposta apara e respeita o teto', () => {
    expect(textoDaResposta('  oi  ')).toBe('oi');
    expect(textoDaResposta('x'.repeat(TEXTO_MAX + 10)).length).toBe(TEXTO_MAX);
  });

  it('telefoneLegivel formata número brasileiro com e sem nono dígito', () => {
    expect(telefoneLegivel('5511987654321')).toBe('+55 (11) 98765-4321');
    expect(telefoneLegivel('551187654321')).toBe('+55 (11) 8765-4321');
    expect(telefoneLegivel('14155550100')).toBe('+14155550100');
    expect(telefoneLegivel('')).toBe('');
  });
});

// Contrato com a caixa e o app (fechado com o subagente da caixa): o destino
// sai de pendencias.email_thread_id e a resposta devolve { success, to } com
// os dígitos crus. O handler depende do Deno, então a trava é no fonte.
describe('contrato do whatsapp-responder', () => {
  const ler = (rel) =>
    fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const responder = ler('../supabase/functions/whatsapp-responder/index.ts');
  const webhook = ler('../supabase/functions/whatsapp/index.ts');

  it('o destino sai do email_thread_id do chamado', () => {
    expect(responder).toContain('telefoneDaConversa(pen.email_thread_id)');
  });

  it('o body só traz o chamado e o texto, nunca o telefone', () => {
    expect(responder).toContain('const { pendencia_id, text } = await req.json();');
    expect(responder).not.toMatch(/\b(phone|telefone|to)\b\s*[,}]\s*=\s*await req\.json/);
  });

  it('responde { success: true, to } com os dígitos', () => {
    expect(responder).toContain('json({ success: true, to: tel, id: envio.id || null })');
  });

  it('o webhook procura o chamado aberto pela mesma chave', () => {
    expect(webhook).toContain('.eq("email_thread_id", conversa)');
    expect(webhook).toContain('conversaDoTelefone(m.telefone)');
  });
});
