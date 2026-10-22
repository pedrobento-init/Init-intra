import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.slaPrazoSugerido = undefined;
const sla = require('../js/sla.js');
globalThis.slaPrazoSugerido = sla.slaPrazoSugerido; // pendencias-rapida usa a global
const { penRapidaData } = require('../js/pendencias-rapida.js');

// Datas locais (o SLA conta em horário do aparelho). 2026-10-23 é sexta.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (y, m, d, h, min) => local(y, m, d, h, min).toISOString();

describe('horário comercial', () => {
  it('soma horas dentro do expediente', () => {
    expect(sla.slaAddBusinessHours(local(2026, 10, 21, 9), 4)).toEqual(local(2026, 10, 21, 13));
  });
  it('passa para o próximo dia útil e pula o fim de semana', () => {
    // Sexta 17h + 8h úteis = 1h na sexta + 7h na segunda → segunda 15h
    expect(sla.slaAddBusinessHours(local(2026, 10, 23, 17), 8)).toEqual(local(2026, 10, 26, 15));
  });
  it('fora do expediente começa a contar no próximo início', () => {
    expect(sla.slaAddBusinessHours(local(2026, 10, 21, 22), 1)).toEqual(local(2026, 10, 22, 9));
    expect(sla.slaAddBusinessHours(local(2026, 10, 24, 10), 1)).toEqual(local(2026, 10, 26, 9)); // sábado
  });
  it('dias úteis: 0 = hoje, fim de semana vai para segunda', () => {
    expect(sla.slaAddBusinessDays('2026-10-21', 0)).toBe('2026-10-21');
    expect(sla.slaAddBusinessDays('2026-10-23', 1)).toBe('2026-10-26');
    expect(sla.slaAddBusinessDays('2026-10-24', 0)).toBe('2026-10-26');
    expect(sla.slaAddBusinessDays('2026-10-21', 7)).toBe('2026-10-30');
  });
  it('prazo sugerido segue a prioridade', () => {
    expect(sla.slaPrazoSugerido('critica', '2026-10-21')).toBe('2026-10-21');
    expect(sla.slaPrazoSugerido('alta', '2026-10-21')).toBe('2026-10-22');
    expect(sla.slaPrazoSugerido('media', '2026-10-21')).toBe('2026-10-26');
    expect(sla.slaPrazoSugerido('xyz', '2026-10-21')).toBe('2026-10-26'); // desconhecida = média
    expect(sla.slaResumo('alta')).toBe('1ª resposta em 4h úteis · prazo 1 dia útil');
  });
});

describe('1ª resposta ao gravar', () => {
  const criada = () => ({ id: 'P1', status: 'aberto', priority: 'alta', createdAt: iso(2026, 10, 21, 9, 0), notes: [] });

  it('criação define o prazo da resposta pela prioridade', () => {
    const p = sla.slaOnSave(null, criada(), iso(2026, 10, 21, 9, 0), 'Ana');
    expect(p.firstResponseDue).toBe(iso(2026, 10, 21, 13, 0));
    expect(p.firstResponseAt).toBeUndefined();
  });

  it('criar já em andamento conta como respondida na hora', () => {
    const p = sla.slaOnSave(null, { ...criada(), status: 'em_andamento' }, iso(2026, 10, 21, 9, 0), 'Ana');
    expect(p.firstResponseAt).toBe(iso(2026, 10, 21, 9, 0));
    expect(p.firstResponseBy).toBe('Ana');
  });

  it('responde com nota, cronômetro ou status saindo de Aberto — só a primeira vez', () => {
    const base = sla.slaOnSave(null, criada(), iso(2026, 10, 21, 9, 0), 'Ana');
    const nota = sla.slaOnSave(base, { ...base, notes: [{ text: 'vi', visibility: 'resposta' }] }, iso(2026, 10, 21, 10, 0), 'Beto');
    expect([nota.firstResponseAt, nota.firstResponseBy]).toEqual([iso(2026, 10, 21, 10, 0), 'Beto']);
    const depois = sla.slaOnSave(nota, { ...nota, status: 'em_andamento' }, iso(2026, 10, 21, 11, 0), 'Gil');
    expect(depois.firstResponseBy).toBe('Beto');

    const timer = sla.slaOnSave(base, { ...base, timerRunning: true }, iso(2026, 10, 21, 9, 30), 'Gil');
    expect(timer.firstResponseAt).toBe(iso(2026, 10, 21, 9, 30));
    const status = sla.slaOnSave(base, { ...base, status: 'aguardando_cliente' }, iso(2026, 10, 21, 9, 45), 'Gil');
    expect(status.firstResponseAt).toBe(iso(2026, 10, 21, 9, 45));
  });

  // Separação resposta × anotação interna: o SLA de 1ª resposta mede "o
  // solicitante foi respondido". Conversa da equipe não é resposta — se
  // contasse, o número deixaria de significar isso.
  it('anotação interna NÃO conta como 1ª resposta', () => {
    const base = sla.slaOnSave(null, criada(), iso(2026, 10, 21, 9, 0), 'Ana');
    const interna = sla.slaOnSave(base, { ...base, notes: [{ text: 'cliente é chato', visibility: 'interna' }] }, iso(2026, 10, 21, 10, 0), 'Beto');
    expect(interna.firstResponseAt).toBeUndefined();
    // e a resposta seguinte conta normalmente
    const resp = sla.slaOnSave(interna, { ...interna, notes: [...interna.notes, { text: 'bom dia', visibility: 'resposta' }] }, iso(2026, 10, 21, 11, 0), 'Beto');
    expect([resp.firstResponseAt, resp.firstResponseBy]).toEqual([iso(2026, 10, 21, 11, 0), 'Beto']);
  });

  it('nota antiga, sem o campo visibility, não conta (fail-closed)', () => {
    const base = sla.slaOnSave(null, criada(), iso(2026, 10, 21, 9, 0), 'Ana');
    const velha = sla.slaOnSave(base, { ...base, notes: [{ text: 'sem campo' }] }, iso(2026, 10, 21, 10, 0), 'Beto');
    expect(velha.firstResponseAt).toBeUndefined();
  });

  it('editar o texto ou o prazo não conta como resposta', () => {
    const base = sla.slaOnSave(null, criada(), iso(2026, 10, 21, 9, 0), 'Ana');
    const ed = sla.slaOnSave(base, { ...base, assunto: 'novo', deadline: '2026-10-30' }, iso(2026, 10, 21, 10, 0), 'Ana');
    expect(ed.firstResponseAt).toBeUndefined();
  });

  it('trocar a prioridade antes de responder recalcula o prazo; depois, não', () => {
    const base = sla.slaOnSave(null, criada(), iso(2026, 10, 21, 9, 0), 'Ana');
    const crit = sla.slaOnSave(base, { ...base, priority: 'critica' }, iso(2026, 10, 21, 9, 5), 'Ana');
    expect(crit.firstResponseDue).toBe(iso(2026, 10, 21, 10, 0));
    const resp = sla.slaOnSave(crit, { ...crit, notes: [{ text: 'ok', visibility: 'resposta' }] }, iso(2026, 10, 21, 9, 30), 'Ana');
    const baixa = sla.slaOnSave(resp, { ...resp, priority: 'baixa' }, iso(2026, 10, 21, 9, 40), 'Ana');
    expect(baixa.firstResponseDue).toBe(iso(2026, 10, 21, 10, 0));
  });

  it('pendência antiga (sem prazo de resposta) não ganha SLA ao ser editada', () => {
    const antiga = { id: 'P0', status: 'aberto', priority: 'alta', createdAt: iso(2026, 1, 5, 9, 0), notes: [] };
    const ed = sla.slaOnSave(antiga, { ...antiga, notes: [{ text: 'x' }] }, iso(2026, 10, 21, 9, 0), 'Ana');
    expect(ed.firstResponseDue).toBeUndefined();
    expect(ed.firstResponseAt).toBeUndefined();
  });
});

describe('situação e números da 1ª resposta', () => {
  const now = local(2026, 10, 21, 12).getTime();
  const pen = (o) => ({ status: 'aberto', createdAt: iso(2026, 10, 21, 9, 0), ...o });

  it('classifica: atrasada, vence logo, no prazo, respondida, sem SLA', () => {
    expect(sla.slaRespostaEstado(pen({ firstResponseDue: iso(2026, 10, 21, 11, 0) }), now)).toEqual({ estado: 'atrasada', minutos: 60 });
    expect(sla.slaRespostaEstado(pen({ firstResponseDue: iso(2026, 10, 21, 12, 30) }), now).estado).toBe('vence_logo');
    expect(sla.slaRespostaEstado(pen({ firstResponseDue: iso(2026, 10, 21, 17, 0) }), now).estado).toBe('no_prazo');
    expect(sla.slaRespostaEstado(pen({ firstResponseDue: iso(2026, 10, 21, 13, 0), firstResponseAt: iso(2026, 10, 21, 9, 20) }), now))
      .toEqual({ estado: 'respondida', noPrazo: true, minutos: 20 });
    expect(sla.slaRespostaEstado(pen({}), now).estado).toBe('sem_sla');
    // Resolvida sem resposta registrada não fica "atrasada" para sempre.
    expect(sla.slaRespostaEstado(pen({ status: 'resolvido', firstResponseDue: iso(2026, 10, 21, 10, 0) }), now).estado).toBe('sem_sla');
  });

  it('KPIs: aguardando, atrasadas, % no prazo e mediana', () => {
    const k = sla.buildRespostaKpis([
      pen({ firstResponseDue: iso(2026, 10, 21, 11, 0) }),
      pen({ firstResponseDue: iso(2026, 10, 21, 17, 0) }),
      pen({ firstResponseDue: iso(2026, 10, 21, 13, 0), firstResponseAt: iso(2026, 10, 21, 9, 10) }),
      pen({ firstResponseDue: iso(2026, 10, 21, 10, 0), firstResponseAt: iso(2026, 10, 21, 11, 0) }),
      pen({}),
    ], now, 30);
    expect(k).toEqual({ aguardando: 2, atrasadas: 1, respondidas: 2, pctNoPrazo: 50, medianaMin: 10 });
  });

  it('selo do card só aparece com atraso ou perto de vencer', () => {
    expect(sla.penRespostaBadge(pen({ firstResponseDue: iso(2026, 10, 21, 17, 0) }), now)).toBe('');
    expect(sla.penRespostaBadge(pen({ firstResponseDue: iso(2026, 10, 21, 11, 0) }), now)).toContain('Sem resposta · 1h atrasada');
    expect(sla.penRespostaBadge(pen({ firstResponseDue: iso(2026, 10, 21, 17, 0) }), now, { full: true })).toContain('Responder em 5h');
    expect(sla.slaDuracaoCurta(90)).toBe('1h30');
    expect(sla.slaDuracaoCurta(3000)).toBe('2 dias');
  });
});

describe('problemas recorrentes', () => {
  const p = (id, clientId, categoria, dia, o) => ({ id, clientId, clientName: clientId === 'c1' ? 'Acme' : 'Zeta', categoria, assunto: 'a' + id,
    status: 'resolvido', createdAt: '2026-' + dia + 'T12:00:00.000Z', ...o });
  const pens = [
    p('1', 'c1', 'impressora', '10-01'), p('2', 'c1', 'impressora', '10-05'), p('3', 'c1', 'impressora', '10-15', { status: 'aberto' }),
    p('4', 'c1', 'rede', '10-02'), p('5', 'c2', 'impressora', '10-03'), p('6', 'c2', 'impressora', '10-04'),
    p('7', 'c1', 'impressora', '06-01'), // fora dos 90 dias
    p('8', 'c1', 'impressora', '10-06', { status: 'cancelado' }), // cancelada não conta
    p('9', 'c2', '', '10-07', { canal: 'whatsapp', solicitante: 'Maria' }),
    p('10', 'c2', 'rede', '10-08', { canal: 'whatsapp', solicitante: ' maria ' }),
    p('11', 'c1', 'rede', '10-09', { canal: 'telefone', solicitante: 'João' }),
  ];

  it('acha cliente × categoria com 3+ ocorrências, mais recentes primeiro', () => {
    const m = sla.buildRecorrentesModel(pens, '2026-10-20');
    expect(m.recorrentes.map((g) => [g.clientId, g.categoria, g.total, g.abertas])).toEqual([['c1', 'impressora', 3, 1]]);
    expect(m.recorrentes[0].itens.map((i) => i.id)).toEqual(['3', '2', '1']);
  });

  it('conta categoria, canal, sem categoria e quem mais pede', () => {
    const m = sla.buildRecorrentesModel(pens, '2026-10-20');
    expect(m.total).toBe(9);
    expect(m.semCategoria).toBe(1);
    expect(m.porCategoria).toEqual([{ value: 'impressora', total: 5 }, { value: 'rede', total: 3 }]);
    expect(m.porCanal).toEqual([{ value: 'whatsapp', total: 2 }, { value: 'telefone', total: 1 }]);
    expect(m.solicitantes.map((s) => [s.nome, s.total])).toEqual([['Maria', 2]]);
  });

  it('sugere solicitantes do cliente, mais recentes primeiro e sem repetir', () => {
    expect(sla.solicitantesDoCliente(pens, 'c2')).toEqual(['maria']);
    expect(sla.solicitantesDoCliente(pens, 'c1')).toEqual(['João']);
    expect(sla.solicitantesDoCliente(pens, '')).toEqual([]);
  });
});

describe('abertura rápida', () => {
  it('monta pendência de suporte aberta, com prazo pelo SLA e descrição = assunto', () => {
    const d = penRapidaData({ assunto: '  Impressora parou ', priority: 'alta', clientId: 'c1', clientName: 'Acme',
      responsible: 'Ana', categoria: 'impressora', canal: 'whatsapp', solicitante: ' Maria ' }, '2026-10-23');
    expect(d).toMatchObject({ tipo: 'Suporte', status: 'aberto', assunto: 'Impressora parou', descricao: 'Impressora parou',
      priority: 'alta', deadline: '2026-10-26', solicitante: 'Maria', canal: 'whatsapp', categoria: 'impressora', responsible: 'Ana' });
  });
  it('prioridade inválida vira média e detalhes digitados ficam na descrição', () => {
    const d = penRapidaData({ assunto: 'x', priority: '???', descricao: 'erro 0x1' }, '2026-10-21');
    expect([d.priority, d.descricao, d.deadline]).toEqual(['media', 'erro 0x1', '2026-10-26']);
  });
});

// SLA de resolução: lê o que já existia — `deadline` (preenchido por
// slaPrazoSugerido, em dias úteis pela prioridade) e `completedAt`.
// Nenhuma coluna nova; é o par do SLA de 1ª resposta.
describe('situação da resolução', () => {
  const aberta = (over = {}) => ({
    id: 'P1', status: 'em_andamento', priority: 'alta',
    createdAt: iso(2026, 10, 20, 9, 0), deadline: '2026-10-23', ...over,
  });
  const agora = (y, m, d, h, min) => local(y, m, d, h, min).getTime();

  it('sem prazo não há SLA de resolução', () => {
    expect(sla.slaResolucaoEstado(aberta({ deadline: null }), agora(2026, 10, 21, 9, 0)).estado).toBe('sem_sla');
  });

  it('faltando mais de um dia: no prazo', () => {
    expect(sla.slaResolucaoEstado(aberta(), agora(2026, 10, 21, 9, 0)).estado).toBe('no_prazo');
  });

  it('faltando menos de um dia: vence logo', () => {
    expect(sla.slaResolucaoEstado(aberta(), agora(2026, 10, 23, 9, 0)).estado).toBe('vence_logo');
  });

  it('passou do prazo e segue aberta: estourada', () => {
    const st = sla.slaResolucaoEstado(aberta(), agora(2026, 10, 24, 9, 0));
    expect(st.estado).toBe('estourada');
    expect(st.minutos).toBeGreaterThan(0);
  });

  // O prazo é um DIA, não um instante: resolver às 15h do próprio dia do
  // vencimento tem que contar como no prazo.
  it('resolver no próprio dia do vencimento conta como no prazo', () => {
    const p = aberta({ status: 'resolvido', completedAt: iso(2026, 10, 23, 15, 0) });
    const st = sla.slaResolucaoEstado(p, agora(2026, 10, 25, 9, 0));
    expect(st.estado).toBe('resolvida');
    expect(st.noPrazo).toBe(true);
  });

  it('resolver depois do prazo marca fora do prazo', () => {
    const p = aberta({ status: 'resolvido', completedAt: iso(2026, 10, 24, 10, 0) });
    expect(sla.slaResolucaoEstado(p, agora(2026, 10, 25, 9, 0))).toMatchObject({ estado: 'resolvida', noPrazo: false });
  });

  it('fechada sem completedAt (legado) não é julgada', () => {
    const p = aberta({ status: 'resolvido' });
    expect(sla.slaResolucaoEstado(p, agora(2026, 10, 25, 9, 0)).estado).toBe('sem_sla');
  });

  it('o selo só fala sozinho quando exige ação', () => {
    expect(sla.penResolucaoBadge(aberta(), agora(2026, 10, 21, 9, 0))).toBe('');
    expect(sla.penResolucaoBadge(aberta(), agora(2026, 10, 24, 9, 0))).toContain('Vencida');
    expect(sla.penResolucaoBadge(aberta(), agora(2026, 10, 21, 9, 0), { full: true })).toContain('Resolver em');
  });
});
