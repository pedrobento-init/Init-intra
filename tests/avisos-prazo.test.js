import { describe, it, expect } from 'vitest';
import {
  todayBR, pendenciaAvisoDevido, pendenciaAvisoKey, vencAvisoDevido, recipientsFor,
  pendenciaEmail, vencimentoEmail, isPendenciaGestao,
} from '../supabase/functions/avisos-prazo/avisos.ts';

// Regras dos avisos enviados pelo servidor (Edge Function avisos-prazo).
const TODAY = '2026-10-18';
const v = (o) => Object.assign({ id: 'V1', status: 'ativo', tipo: 'ssl', descricao: 'SSL', avisos: [] }, o);

const OPS = [
  { id: 'OP-ana', name: 'Ana', email: 'ana@initnet.com.br', active: true, is_admin: false, is_gestao: false },
  { id: 'OP-pedro', name: 'Pedro', email: 'pedro@initnet.com.br', active: true, is_admin: true, is_gestao: false },
  { id: 'OP-felipe', name: 'Felipe', email: 'felipe@initnet.com.br', active: true, is_admin: true, is_gestao: true },
  { id: 'OP-velho', name: 'Velho', email: 'velho@initnet.com.br', active: false, is_admin: true, is_gestao: true },
  { id: 'OP-sem', name: 'Sem Email', email: null, active: true, is_admin: true, is_gestao: false },
];

describe('data de hoje no horário de Brasília', () => {
  it('23h de Brasília ainda é o mesmo dia (02h UTC do dia seguinte)', () => {
    expect(todayBR(new Date('2026-10-19T02:00:00Z'))).toBe('2026-10-18');
    expect(todayBR(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-19');
  });
});

describe('lembrete de pendência', () => {
  const p = (o) => Object.assign({ id: 'PEN-1', status: 'aberto' }, o);
  it('2 e 1 dia antes: "antes"; no dia: "hoje"', () => {
    expect(pendenciaAvisoDevido(p({ deadline: '2026-10-20' }), TODAY)).toEqual({ tipo: 'antes', days: 2 });
    expect(pendenciaAvisoDevido(p({ deadline: '2026-10-19' }), TODAY)).toEqual({ tipo: 'antes', days: 1 });
    expect(pendenciaAvisoDevido(p({ deadline: TODAY }), TODAY)).toEqual({ tipo: 'hoje', days: 0 });
  });
  it('vencida, longe ou fechada: nada', () => {
    expect(pendenciaAvisoDevido(p({ deadline: '2026-10-17' }), TODAY)).toBeNull();
    expect(pendenciaAvisoDevido(p({ deadline: '2026-10-21' }), TODAY)).toBeNull();
    expect(pendenciaAvisoDevido(p({ deadline: TODAY, status: 'concluido' }), TODAY)).toBeNull();
    expect(pendenciaAvisoDevido(p({ deadline: null }), TODAY)).toBeNull();
  });
  it('a chave muda com o prazo: prazo remarcado ganha lembrete novo', () => {
    expect(pendenciaAvisoKey(p({ deadline: '2026-10-20' }), 'antes')).toBe('pendencia:PEN-1:2026-10-20:antes');
    expect(pendenciaAvisoKey(p({ deadline: '2026-10-25' }), 'antes')).not.toBe(pendenciaAvisoKey(p({ deadline: '2026-10-20' }), 'antes'));
  });
});

describe('aviso de vencimento', () => {
  it('aviso de 30 dias sai uma vez', () => {
    const a = v({ data_vencimento: '2026-11-10' });
    expect(vencAvisoDevido(a, TODAY)).toEqual({ aviso: '30', marcar: ['30'], days: 23 });
    expect(vencAvisoDevido({ ...a, avisos: ['30'] }, TODAY)).toBeNull();
  });
  it('já dentro dos 7 dias: manda só o de 7 e marca o de 30 junto', () => {
    expect(vencAvisoDevido(v({ data_vencimento: '2026-10-21' }), TODAY)).toEqual({ aviso: '7', marcar: ['30', '7'], days: 3 });
  });
  it('no dia manda o "0"; vencido há mais de 7 dias, longe ou encerrado: nada', () => {
    expect(vencAvisoDevido(v({ data_vencimento: TODAY, avisos: ['30', '7'] }), TODAY)).toEqual({ aviso: '0', marcar: ['0'], days: 0 });
    expect(vencAvisoDevido(v({ data_vencimento: '2026-10-01' }), TODAY)).toBeNull();
    expect(vencAvisoDevido(v({ data_vencimento: '2026-12-31' }), TODAY)).toBeNull();
    expect(vencAvisoDevido(v({ data_vencimento: TODAY, status: 'encerrado' }), TODAY)).toBeNull();
  });
});

describe('destinatários', () => {
  it('responsável + admins ativos com e-mail, sem repetir', () => {
    expect(recipientsFor(OPS, { name: 'ana' })).toEqual(['ana@initnet.com.br', 'pedro@initnet.com.br', 'felipe@initnet.com.br']);
    expect(recipientsFor(OPS, { id: 'OP-pedro', name: 'Outro nome' })).toEqual(['pedro@initnet.com.br', 'felipe@initnet.com.br']);
  });
  it('responsável desconhecido: só admins', () => {
    expect(recipientsFor(OPS, { name: 'Ninguém' })).toEqual(['pedro@initnet.com.br', 'felipe@initnet.com.br']);
  });
  it('Gestão: só quem é Gestão e está ativo (responsável não-Gestão fica de fora)', () => {
    expect(isPendenciaGestao({ id: 'x', tipo: 'Gestão' })).toBe(true);
    expect(recipientsFor(OPS, { name: 'Ana' }, { gestao: true })).toEqual(['felipe@initnet.com.br']);
  });
});

describe('texto do e-mail', () => {
  it('escapa HTML vindo dos dados e usa o assunto como título', () => {
    const m = pendenciaEmail({ id: 'P', assunto: '<b>x</b>', client_name: 'A & B', deadline: '2026-10-19', priority: 'alta' }, 1, 'https://intra.example/');
    expect(m.subject).toBe('[Init Intra] ⏰ Prazo vence AMANHÃ: <b>x</b>');
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(m.html).toContain('A &amp; B');
    expect(m.html).toContain('19/10/2026');
    expect(m.html).toContain('href="https://intra.example/#pendencias"');
  });
  it('vencimento vencido diz há quantos dias', () => {
    const m = vencimentoEmail(v({ data_vencimento: '2026-10-16', descricao: 'Domínio' }), -2);
    expect(m.subject).toContain('VENCIDO há 2 dias');
    expect(m.html).not.toContain('Ver no Init Intra');
  });
});
