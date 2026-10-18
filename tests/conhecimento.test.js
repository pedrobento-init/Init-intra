import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const K = require('../js/conhecimento.js');

const docs = K.kbCollect({
  procedures: [
    { id: 'a1', clientId: null, title: 'Impressora HP some da rede', category: 'Impressora', content: 'Reinstalar driver e fixar IP na impressora.' },
    { id: 'p1', clientId: 'c1', title: 'Backup do servidor', category: 'Backup', content: 'Conferir job diário no Veeam.' },
  ],
  templates: [{ id: 't1', title: 'Checklist de VPN', category: 'Rede', content: 'Validar túnel IPsec.' }],
  pendencias: [
    { id: 'pen1', status: 'concluido', assunto: 'VPN caindo toda hora', descricao: 'Túnel cai às 18h', notes: [{ text: '▶ Ana iniciou o trabalho.' }, { text: 'Ajustado DPD e lifetime do IPsec.' }], clientName: 'Acme' },
    { id: 'pen2', status: 'aberto', assunto: 'Impressora parada' },
    { id: 'pen3', status: 'concluido', assunto: 'Sem registro' },
  ],
  clientName: (id) => (id === 'c1' ? 'Acme' : ''),
});

describe('base de conhecimento', () => {
  it('junta artigos, procedimentos, modelos e só os casos resolvidos com registro', () => {
    expect(docs.map((d) => d.kind + ':' + d.id)).toEqual(['artigo:a1', 'procedimento:p1', 'modelo:t1', 'caso:pen1']);
    expect(docs[3].body).toContain('Ajustado DPD');
    expect(docs[3].body).not.toContain('iniciou o trabalho'); // nota automática fica de fora
  });

  it('busca ignora acento e caixa; todos os termos precisam bater; título pesa mais', () => {
    expect(K.kbSearch(docs, 'impressora').map((d) => d.id)).toEqual(['a1']);
    expect(K.kbSearch(docs, 'TÚNEL ipsec').map((d) => d.id).sort()).toEqual(['pen1', 't1']);
    expect(K.kbSearch(docs, 'vpn').map((d) => d.id).sort()).toEqual(['pen1', 't1']);
    expect(K.kbSearch(docs, 'impressora veeam')).toEqual([]);
    expect(K.kbSearch(docs, 'de a o')).toEqual([]); // só stopwords
  });

  it('relacionados: sugere o que parece com o problema, não qualquer coisa', () => {
    const rel = K.kbRelated(docs, 'A VPN do cliente cai no fim do dia, túnel IPsec');
    expect(rel.map((d) => d.id)).toContain('pen1');
    expect(K.kbRelated(docs, 'Trocar toner')).toEqual([]);
    expect(K.kbRelated(docs, 'VPN caindo toda hora', { excludeId: 'pen1' }).map((d) => d.id)).not.toContain('pen1');
  });

  it('artigo a partir de pendência resolvida', () => {
    const a = K.kbArticleFromPendencia({ assunto: 'VPN caindo', descricao: 'Cai às 18h', notes: [{ text: 'Ajustado DPD.' }, { text: '⏸ Ana pausou. Tempo sessão: 00:10:00.' }], clientName: 'Acme', completedAt: '2026-10-10T12:00:00Z' });
    expect(a.title).toBe('VPN caindo');
    expect(a.content).toContain('Problema:\nCai às 18h');
    expect(a.content).toContain('- Ajustado DPD.');
    expect(a.content).not.toContain('pausou');
  });
});
