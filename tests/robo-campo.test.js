import { describe, it, expect } from 'vitest';
import {
  aplicarEmail, assuntoLimpo, backupAlerta, briefingDados, briefingHtml, briefingTemConteudo, classificarBackup,
  clienteDoEmail, diasSemComunicar, monitorDoEmail, nomeDoRemetente, pendenciaDaTriagem, pendenciaDoAlerta,
  primeiraRespostaDue, textoDaIa, triagemDaIa,
} from '../supabase/functions/robo/campo.ts';

const today = '2026-10-21';

describe('briefing antes da visita', () => {
  const visita = { id: 'V0', client_name: 'Acme', date: today, time: '14:00:00', motivo: 'Formatação', status: 'agendada',
    observacoes: 'Falar com a Ana', levar: [{ t: 'Pendrive', ok: false }] };
  const ctx = {
    today,
    visitas: [
      { id: 'V1', date: '2026-09-01', motivo: 'Rede', status: 'concluida', relatorio: 'Troquei o switch.' },
      { id: 'V2', date: '2026-10-01', motivo: 'Impressora', status: 'concluida', relatorio: '' },
      { id: 'V3', date: '2026-08-01', motivo: 'Antiga', status: 'concluida' },
      { id: 'V4', date: '2026-07-01', motivo: 'Mais antiga', status: 'concluida' },
      { id: 'V5', date: '2026-10-10', motivo: 'Cancelada', status: 'cancelada' },
    ],
    pendencias: [
      { id: 'P1', assunto: 'Toner', status: 'aberto', deadline: '2026-10-15', priority: 'alta' },
      { id: 'P2', assunto: 'Fechada', status: 'resolvido' },
    ],
    vencimentos: [
      { id: 'X1', tipo: 'ssl', descricao: 'SSL acme.com', data_vencimento: '2026-11-01', status: 'ativo' },
      { id: 'X2', tipo: 'licenca', descricao: 'Longe', data_vencimento: '2027-06-01', status: 'ativo' },
    ],
    devices: [
      { hostname: 'PC-01', is_ativo: true, data_ultima_atualizacao: '2026-10-01T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
      { hostname: 'PC-02', is_ativo: true, data_ultima_atualizacao: '2026-10-19T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
      { hostname: 'PC-03', is_ativo: false, data_ultima_atualizacao: '2026-01-01T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' },
    ],
    monitores: [{ id: 'M1', client_id: 'C', nome: 'Veeam', identificador: 'veeam', max_horas: 48, ultimo_status: 'falha' }],
  };
  const b = briefingDados(visita, ctx);

  it('últimas 3 visitas concluídas, mais nova primeiro', () => {
    expect(b.ultimas_visitas.map((x) => x.motivo)).toEqual(['Impressora', 'Rede', 'Antiga']);
  });
  it('pendências abertas (atrasada marcada), vencimentos em até 45 dias, dispositivo parado há >7 dias, backup com falha', () => {
    expect(b.pendencias_abertas).toEqual([{ assunto: 'Toner', status: 'aberto', prioridade: 'alta', prazo: '2026-10-15', atrasada: true }]);
    expect(b.vencimentos_proximos.map((x) => x.descricao)).toEqual(['SSL acme.com']);
    expect(b.dispositivos_sem_comunicar).toEqual([{ nome: 'PC-01', dias: 19 }]);
    expect(b.backups).toEqual([{ nome: 'Veeam', status: 'falha', ultimo: '' }]);
    expect(b.levar).toEqual(['Pendrive']);
    expect(briefingTemConteudo(b)).toBe(true);
  });
  it('HTML com fatos e o texto da IA escapado', () => {
    const h = briefingHtml(b, 'Atenção ao <switch>');
    expect(h).toContain('💡 Atenção ao &lt;switch&gt;');
    expect(h).toContain('Toner');
    expect(h).toContain('(atrasada)');
    expect(h).toContain('PC-01 — 19 dias');
    expect(h).toContain('Veeam');
  });
  it('texto corrido para o prompt da IA', async () => {
    const { briefingTexto } = await import('../supabase/functions/robo/campo.ts');
    const t = briefingTexto(b);
    expect(t).toContain('Cliente: Acme');
    expect(t).toContain('Visita: 21/10/2026 14:00 — motivo: Formatação');
    expect(t).toContain('- Toner (aberto, prioridade alta, ATRASADA)');
    expect(t).toContain('- PC-01: 19 dias');
    expect(t).toContain('- Veeam: falha');
  });
  it('cliente sem histórico nenhum não gera briefing', () => {
    const vazio = briefingDados(visita, { today, visitas: [], pendencias: [], vencimentos: [], devices: [], monitores: [] });
    expect(briefingTemConteudo(vazio)).toBe(false);
  });
  it('resposta do Make: JSON {texto}, texto puro, ou "Accepted" (sem resposta configurada)', () => {
    expect(textoDaIa('{"texto":"  Leve o cabo. "}')).toBe('Leve o cabo.');
    expect(textoDaIa('Leve o cabo.')).toBe('Leve o cabo.');
    expect(textoDaIa('Accepted')).toBeNull();
    expect(textoDaIa('')).toBeNull();
    // Teto padrão é do briefing; o relatório da visita passa um maior.
    expect(textoDaIa('x'.repeat(2000))).toHaveLength(1200);
    expect(textoDaIa('x'.repeat(2000), 8000)).toHaveLength(2000);
  });
  it('dispositivo: dias sem comunicar medidos na última sincronização', () => {
    expect(diasSemComunicar({ is_ativo: true, data_ultima_atualizacao: '2026-10-19T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' })).toBeNull();
    expect(diasSemComunicar({ is_ativo: true, data_ultima_atualizacao: '2026-10-01T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' })).toBe(19);
  });
});

describe('backup por e-mail', () => {
  it('classifica pelo assunto (falha > aviso > ok) e, sem pista, pelo corpo', () => {
    expect(classificarBackup('[Success] Job Servidor (2 VMs)')).toBe('ok');
    expect(classificarBackup('[Failed] Job Servidor')).toBe('falha');
    expect(classificarBackup('[Warning] Job Servidor')).toBe('aviso');
    expect(classificarBackup('Backup concluído com sucesso')).toBe('ok');
    expect(classificarBackup('Backup FALHOU no NAS')).toBe('falha');
    expect(classificarBackup('Relatório diário', 'Status: Sucesso. Erros: 0')).toBe('ok');
    expect(classificarBackup('Relatório diário', 'Nada a dizer')).toBeNull();
  });
  const mons = [
    { id: 'M1', client_id: 'C1', nome: 'Veeam', identificador: 'veeam', max_horas: 48, ativo: true },
    { id: 'M2', client_id: 'C2', nome: 'Veeam Acme', identificador: 'Job Acme', max_horas: 48, ativo: true },
    { id: 'M3', client_id: 'C3', nome: 'Off', identificador: 'nas', max_horas: 48, ativo: false },
  ];
  it('acha o monitor pelo identificador (o mais específico vence; inativo não)', () => {
    expect(monitorDoEmail(mons, { id: 'e', de: 'veeam@x.com', assunto: '[Success] Job ACME', data: '' }).id).toBe('M2');
    expect(monitorDoEmail(mons, { id: 'e', de: 'veeam@x.com', assunto: '[Success] Outro', data: '' }).id).toBe('M1');
    expect(monitorDoEmail(mons, { id: 'e', de: 'nas@x.com', assunto: 'ok', data: '' })).toBeNull();
  });
  it('e-mail mais antigo não sobrescreve o último status, mas entra no histórico', () => {
    const m = { ...mons[0], ultimo_status: 'ok', ultimo_em: '2026-10-21T08:00:00Z', historico: [] };
    const r = aplicarEmail(m, { id: 'e', de: '', assunto: '[Failed] velho', data: '2026-10-20T08:00:00Z' }, 'falha');
    expect(r.ultimo_status).toBe('ok');
    expect(r.historico).toHaveLength(1);
    expect(aplicarEmail(m, { id: 'e', de: '', assunto: '[Failed] novo', data: '2026-10-21T09:00:00Z' }, 'falha').ultimo_status).toBe('falha');
  });
  it('alerta: falha no último e-mail, ou silêncio além do limite (desde a criação se nunca chegou)', () => {
    const agora = new Date('2026-10-21T12:00:00Z');
    expect(backupAlerta({ ...mons[0], ultimo_status: 'falha', ultimo_em: '2026-10-21T08:00:00Z' }, agora)).toEqual({ tipo: 'falha' });
    expect(backupAlerta({ ...mons[0], ultimo_status: 'ok', ultimo_em: '2026-10-20T12:00:00Z' }, agora)).toBeNull();
    expect(backupAlerta({ ...mons[0], ultimo_status: 'ok', ultimo_em: '2026-10-18T12:00:00Z' }, agora)).toEqual({ tipo: 'silencio', horas: 72 });
    expect(backupAlerta({ ...mons[0], created_at: '2026-10-21T00:00:00Z' }, agora)).toBeNull();
    expect(backupAlerta({ ...mons[2], ultimo_status: 'falha' }, agora)).toBeNull();
  });
  it('pendência automática com os valores válidos da 056', () => {
    const p = pendenciaDoAlerta({ ...mons[0], client_name: 'Acme', team: 'mam', responsavel: 'Beto' }, { tipo: 'silencio', horas: 72 }, 'PEN-1');
    expect(p).toMatchObject({ id: 'PEN-1', client_id: 'C1', team: 'mam', responsible: 'Beto', status: 'aberto', priority: 'alta',
      canal: 'proativo', categoria: 'backup', tipo: 'Manutenção', assunto: 'Backup sem notícia há 72 h: Veeam' });
  });
});

describe('triagem de e-mail', () => {
  const clientes = [
    { id: 'C1', name: 'Padaria Pão Quente', team: 'init', technician: 'Pedro', emails: { domain: 'paoquente.com.br' } },
    { id: 'C2', name: 'Acme', team: 'mam', technician: 'Beto', emails: {} },
    { id: 'C3', name: 'Mercado do Zé', team: 'init', technician: '', emails: { domain: 'gmail.com' } },
  ];
  const email = { id: 'm1', de: 'Márcia Souza <marcia@filial.paoquente.com.br>', assunto: 'Re: Enc: impressora parada',
    data: '2026-10-21T13:20:00Z', trecho: 'A impressora do faturamento parou.' };

  it('casa o cliente pelo domínio da ficha, inclusive em subdomínio', () => {
    expect(clienteDoEmail(clientes, email).id).toBe('C1');
  });
  it('sem domínio na ficha, casa pelo nome do cliente no assunto', () => {
    expect(clienteDoEmail(clientes, { ...email, de: 'joao@provedor.net', assunto: 'Chamado Acme: sem rede' }).id).toBe('C2');
  });
  it('domínio de e-mail grátis não casa cliente nenhum', () => {
    expect(clienteDoEmail(clientes, { ...email, de: 'alguem@gmail.com', assunto: 'oi' })).toBeNull();
  });
  it('assunto perde os Re:/Enc: e o remetente dá o solicitante', () => {
    expect(assuntoLimpo('Re: Enc: impressora parada')).toBe('impressora parada');
    expect(nomeDoRemetente(email.de)).toBe('Márcia Souza');
    expect(nomeDoRemetente('marcia@paoquente.com.br')).toBe('marcia');
  });
  it('resposta do Make validada contra as listas fechadas', () => {
    const t = triagemDaIa(JSON.stringify({ assunto: 'Impressora do faturamento não imprime', descricao: 'Parou ontem.',
      categoria: 'impressora', prioridade: 'alta', tipo: 'Suporte', solicitante: 'Márcia', ignorar: false }), email);
    expect(t).toMatchObject({ ignorar: false, categoria: 'impressora', prioridade: 'alta', tipo: 'Suporte', semIa: false });
  });
  it('categoria e tipo inventados caem no padrão, e crítica para em alta', () => {
    const t = triagemDaIa(JSON.stringify({ categoria: 'nuvem', tipo: 'Urgência', prioridade: 'critica' }), email);
    expect(t).toMatchObject({ categoria: 'outro', tipo: 'Suporte', prioridade: 'alta' });
  });
  it('propaganda vem marcada para ignorar', () => {
    expect(triagemDaIa(JSON.stringify({ assunto: '50% OFF', ignorar: true }), email).ignorar).toBe(true);
  });
  it('Make fora do ar: vale o texto do próprio e-mail, com marca de sem-IA', () => {
    const t = triagemDaIa('Accepted', email);
    expect(t).toMatchObject({ assunto: 'impressora parada', descricao: 'A impressora do faturamento parou.',
      categoria: 'outro', prioridade: 'media', tipo: 'Suporte', solicitante: 'Márcia Souza', semIa: true, ignorar: false });
    expect(pendenciaDaTriagem(t, email, clientes[1], 'PEN-2').tags).toEqual(['triagem-automatica', 'sem-classificacao-ia']);
  });
  it('prazo de 1ª resposta em horas úteis, igual ao js/sla.js', () => {
    // Sexta 17:00 de Brasília + 4 h úteis → segunda 11:00 (14:00 UTC).
    expect(primeiraRespostaDue('alta', new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-19T14:00:00.000Z');
    // Sábado: começa na abertura do próximo dia útil.
    expect(primeiraRespostaDue('critica', new Date('2026-10-17T23:00:00Z'))).toBe('2026-10-19T12:00:00.000Z');
  });
  it('pendência da triagem com os valores válidos da 056', () => {
    const t = triagemDaIa(JSON.stringify({ assunto: 'Impressora não imprime', descricao: 'Parou ontem.',
      categoria: 'impressora', prioridade: 'alta', tipo: 'Suporte', solicitante: 'Márcia' }), email);
    const p = pendenciaDaTriagem(t, email, clientes[0], 'PEN-1', new Date('2026-10-21T13:30:00Z'));
    expect(p).toMatchObject({ id: 'PEN-1', client_id: 'C1', client_name: 'Padaria Pão Quente', team: 'init',
      responsible: 'Pedro', solicitante: 'Márcia', status: 'aberto', priority: 'alta', canal: 'email',
      categoria: 'impressora', tipo: 'Suporte', assunto: 'Impressora não imprime', tags: ['triagem-automatica'] });
    expect(p.descricao).toContain('Assunto original: Re: Enc: impressora parada');
    expect(p.first_response_due).toBe('2026-10-21T17:30:00.000Z');  // 10:30 + 4 h úteis = 14:30 de Brasília
  });
});
