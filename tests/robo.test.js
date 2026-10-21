import { describe, it, expect } from 'vitest';
import {
  dominioDe, dominioDiverge, expiracaoRdap, montarIndicadores, montarResumos, resumoChat, slaPrimeiraResposta,
  vencimentoEvento,
} from '../supabase/functions/robo/relatorios.ts';

const ops = [
  { id: 'OP-A', name: 'Ana Souza', email: 'ana@x', active: true, is_admin: true, is_gestao: false },
  { id: 'OP-B', name: 'Beto Lima', email: 'beto@x', active: true, is_admin: false, is_gestao: false },
  { id: 'OP-C', name: 'Caio', email: 'caio@x', active: false, is_admin: false, is_gestao: false },
];
const today = '2026-10-21';

describe('robô: agenda de vencimentos', () => {
  const v = { id: 'VEN-1', tipo: 'licenca', descricao: 'Office 365', client_name: 'Acme', data_vencimento: '2026-11-03', responsavel: 'Beto Lima' };
  it('evento de dia inteiro, id base32hex estável, não ocupa a agenda', () => {
    const ev = vencimentoEvento(v, 'https://intra.x');
    expect(ev.id).toMatch(/^vc[0-9a-f]+$/);
    expect(ev.id).toBe(vencimentoEvento(v).id);
    expect(ev.summary).toBe('🔔 Licença · Acme: Office 365');
    expect(ev.start).toEqual({ date: '2026-11-03' });
    expect(ev.end).toEqual({ date: '2026-11-04' });
    expect(ev.transparency).toBe('transparent');
    expect(ev.description).toContain('Responsável: Beto Lima');
  });
  it('assinatura muda só quando muda o que aparece', () => {
    const h = vencimentoEvento(v).extendedProperties.private.h;
    expect(vencimentoEvento({ ...v, renovacao_auto: false }).extendedProperties.private.h).toBe(h);
    expect(vencimentoEvento({ ...v, data_vencimento: '2026-11-04' }).extendedProperties.private.h).not.toBe(h);
  });
});

describe('robô: domínios (RDAP)', () => {
  it('acha o domínio na descrição ou observações', () => {
    expect(dominioDe({ id: '1', descricao: 'Domínio acme.com.br' })).toBe('acme.com.br');
    expect(dominioDe({ id: '1', descricao: 'Renovar', observacoes: 'https://www.cliente.com/painel' })).toBe('cliente.com');
    expect(dominioDe({ id: '1', descricao: 'Renovar domínio do cliente' })).toBeNull();
  });
  it('lê a expiração (RFC 9083) no fuso de Brasília', () => {
    expect(expiracaoRdap({ events: [{ eventAction: 'registration', eventDate: '2010-01-01T00:00:00Z' },
      { eventAction: 'expiration', eventDate: '2027-03-15T02:00:00Z' }] })).toBe('2027-03-14');
    expect(expiracaoRdap({})).toBeNull();
  });
  it('diverge só com mais de 1 dia de diferença', () => {
    const v = { id: 'V', data_vencimento: '2027-03-15' };
    expect(dominioDiverge(v, { vencimento_id: 'V', dominio: 'a.com', expira_registro: '2027-03-14', erro: null })).toBe(false);
    expect(dominioDiverge(v, { vencimento_id: 'V', dominio: 'a.com', expira_registro: '2028-03-15', erro: null })).toBe(true);
    expect(dominioDiverge(v, undefined)).toBe(false);
  });
});

describe('robô: resumo diário', () => {
  const visitas = [
    { id: 'V1', numero: 7, client_name: 'Acme', operator_id: 'OP-B', date: today, time: '14:00:00', time_end: '15:00:00', motivo: 'Formatação', status: 'agendada',
      levar: [{ t: 'Pendrive', ok: true }, { t: 'HD externo', ok: false }] },
    { id: 'V2', client_name: 'Zeta', operator: 'Beto Lima', date: today, time: '09:00', motivo: 'Rede', status: 'agendada' },
    { id: 'V3', client_name: 'X', operator_id: 'OP-B', date: today, motivo: 'Cancelada', status: 'cancelada' },
    { id: 'V4', client_name: 'Y', operator_id: 'OP-B', date: '2026-10-22', motivo: 'Amanhã', status: 'agendada' },
  ];
  const pendencias = [
    { id: 'P1', assunto: 'Trocar toner', client_name: 'Acme', responsible_id: 'OP-B', deadline: '2026-10-18', status: 'aberto', priority: 'alta' },
    { id: 'P2', assunto: 'Fechada', responsible_id: 'OP-B', deadline: '2026-10-10', status: 'resolvido' },
    { id: 'P3', assunto: 'Futura', responsible_id: 'OP-B', deadline: '2026-10-30', status: 'aberto' },
  ];
  const vencimentos = [
    { id: 'VEN-1', tipo: 'ssl', descricao: 'SSL acme.com', client_name: 'Acme', data_vencimento: '2026-10-25', responsavel_id: 'OP-B', status: 'ativo' },
    { id: 'VEN-2', tipo: 'dominio', descricao: 'zeta.com.br', client_name: 'Zeta', data_vencimento: '2027-05-01', status: 'ativo' },
  ];
  const dominios = [{ vencimento_id: 'VEN-2', dominio: 'zeta.com.br', expira_registro: '2027-01-10', erro: null }];
  const rs = montarResumos({ today, ops, visitas, pendencias, vencimentos, dominios, appUrl: 'https://intra.x' });
  const beto = rs.find((r) => r.op.id === 'OP-B');
  const ana = rs.find((r) => r.op.id === 'OP-A');

  it('só operadores ativos com e-mail', () => {
    expect(rs.map((r) => r.op.id).sort()).toEqual(['OP-A', 'OP-B']);
  });
  it('técnico: visitas de hoje em ordem (por id ou nome), com o que levar; sem canceladas', () => {
    expect(beto.visitasHoje).toBe(2);
    expect(beto.html.indexOf('Zeta')).toBeLessThan(beto.html.indexOf('#0007'));
    expect(beto.html).toContain('Levar: ☑ Pendrive · ☐ HD externo');
    expect(beto.html).not.toContain('Cancelada');
    expect(beto.html).not.toContain('Amanhã');
  });
  it('técnico: pendência vencida aberta, sem as fechadas e futuras; vencimento dele na semana', () => {
    expect(beto.html).toContain('Trocar toner');
    expect(beto.html).toContain('vencida há 3 dias');
    expect(beto.html).not.toContain('Fechada');
    expect(beto.html).not.toContain('Futura');
    expect(beto.html).toContain('SSL acme.com');
    expect(beto.subject).toBe('[Init Intra] Seu dia 21/10/2026: 2 visitas, 1 pendência para hoje/atrasada, 1 vencimento');
  });
  it('admin: vê os vencimentos da equipe e o domínio que discorda do registro', () => {
    expect(ana.html).toContain('SSL acme.com');
    expect(ana.html).toContain('Domínios com data diferente do registro');
    expect(ana.html).toContain('registro diz 10/01/2027');
    expect(beto.html).not.toContain('zeta.com.br');
  });
  it('dia sem nada fica marcado como vazio (não envia)', () => {
    const [r] = montarResumos({ today, ops: [ops[1]], visitas: [], pendencias: [], vencimentos: [], dominios: [] });
    expect(r.vazio).toBe(true);
  });
  it('texto do Chat com a visão da equipe', () => {
    const t = resumoChat({ today, ops, visitas, pendencias, vencimentos });
    expect(t).toContain('Visitas hoje: 2 (Beto 2)');
    expect(t).toContain('Pendências vencidas: 1');
    expect(t).toContain('Vencimentos nos próximos 7 dias: 1');
  });
});

describe('robô: planilha de indicadores', () => {
  const agora = new Date('2026-10-21T15:00:00Z');
  const abas = montarIndicadores({
    ops, agora,
    clientes: [{ id: 'C1', name: 'Acme' }],
    visitas: [
      { id: 'V1', numero: 1, client_name: 'Acme', operator_id: 'OP-B', date: '2026-10-02', time: '09:00', time_end: '11:30', motivo: 'Rede', status: 'concluida' },
      { id: 'V2', client_name: 'Acme', operator_id: 'OP-B', date: '2026-10-05', all_day: true, motivo: 'X', status: 'agendada' },
    ],
    pendencias: [
      { id: 'P1', assunto: 'A', responsible_id: 'OP-B', status: 'resolvido', created_at: '2026-10-01T13:00:00Z', completed_at: '2026-10-03T13:00:00Z',
        first_response_due: '2026-10-01T15:00:00Z', first_response_at: '2026-10-01T14:00:00Z' },
      { id: 'P2', assunto: 'B', responsible_id: 'OP-B', status: 'aberto', created_at: '2026-10-10T13:00:00Z',
        first_response_due: '2026-10-10T15:00:00Z' },
    ],
    horas: [{ id: 'H1', operator_id: 'OP-B', client_id: 'C1', started_at: '2026-10-02T12:00:00Z', seconds: 5400, source: 'cronometro' }],
  });

  it('abas com cabeçalho e uma linha por registro', () => {
    expect(Object.keys(abas)).toEqual(['Resumo mensal', 'Visitas', 'Pendências', 'Horas']);
    expect(abas['Visitas'][1]).toEqual([1, '2026-10-02', '2026-10', 'Acme', 'Beto Lima', 'Rede', 'concluida', '09:00', '11:30', 2.5]);
    expect(abas['Horas'][1]).toEqual(['2026-10-02', '2026-10', 'Beto Lima', 'Acme', 1.5, 'cronometro', '']);
  });
  it('SLA da 1ª resposta: no prazo / fora (sem resposta e prazo passou) / sem SLA', () => {
    expect(slaPrimeiraResposta({ id: 'x', first_response_due: '2026-10-01T15:00:00Z', first_response_at: '2026-10-01T14:00:00Z' })).toBe('No prazo');
    expect(slaPrimeiraResposta({ id: 'x', first_response_due: '2026-10-10T15:00:00Z' }, agora)).toBe('Fora do prazo');
    expect(slaPrimeiraResposta({ id: 'x', first_response_due: '2026-10-30T15:00:00Z' }, agora)).toBe('Aguardando');
    expect(slaPrimeiraResposta({ id: 'x' })).toBe('');
  });
  it('resumo do mês por técnico: visitas concluídas, horas, resolvidas e % no prazo', () => {
    expect(abas['Resumo mensal'][1]).toEqual(['2026-10', 'Beto Lima', 1, 1.5, 1, 2, 50]);
  });
});
