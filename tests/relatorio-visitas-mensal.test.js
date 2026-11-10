import { describe, expect, it } from 'vitest';
import {
  buildVisitsEmail,
  managerEmails,
  previousMonth,
} from '../supabase/functions/relatorio-visitas-mensal/relatorio.ts';

describe('período do relatório mensal', () => {
  it('usa o mês anterior completo', () => {
    expect(previousMonth('2026-11-01')).toEqual({
      key: '2026-10',
      start: '2026-10-01',
      end: '2026-10-31',
      label: 'outubro de 2026',
    });
  });

  it('cruza a virada de ano e fecha fevereiro corretamente', () => {
    expect(previousMonth('2027-01-01')).toMatchObject({
      key: '2026-12',
      start: '2026-12-01',
      end: '2026-12-31',
    });
    expect(previousMonth('2028-03-01')).toMatchObject({
      key: '2028-02',
      start: '2028-02-01',
      end: '2028-02-29',
    });
  });
});

describe('destinatários do relatório', () => {
  it('envia somente para gestores ativos, sem repetir e-mails', () => {
    expect(
      managerEmails([
        { email: 'gestao@initnet.com.br', active: true, is_gestao: true },
        { email: 'GESTAO@initnet.com.br ', active: true, is_gestao: true },
        { email: 'inativo@initnet.com.br', active: false, is_gestao: true },
        { email: 'tecnico@initnet.com.br', active: true, is_gestao: false },
        { email: null, active: true, is_gestao: true },
      ])
    ).toEqual(['gestao@initnet.com.br']);
  });
});

describe('e-mail do relatório mensal', () => {
  it('resume e detalha as visitas ordenadas, incluindo meses sem registros', () => {
    const period = previousMonth('2026-11-01');
    const mail = buildVisitsEmail(
      [
        {
          id: '2',
          date: '2026-10-20',
          client_name: 'B & Cia',
          operator: 'Ana',
          time: '14:00',
          status: 'cancelada',
        },
        {
          id: '1',
          date: '2026-10-05',
          client_name: '<Cliente>',
          operator: 'Pedro',
          all_day: true,
          motivo: 'Manutenção',
          status: 'concluida',
        },
      ],
      period,
      'https://intra.example/#inicio'
    );

    expect(mail.subject).toBe('[Init Intra] Visitas de outubro de 2026');
    expect(mail.html).toContain('<strong>2 visitas</strong>');
    expect(mail.html).toContain('1 concluída');
    expect(mail.html).toContain('1 cancelada');
    expect(mail.html).toContain('&lt;Cliente&gt;');
    expect(mail.html).toContain('B &amp; Cia');
    expect(mail.html.indexOf('05/10/2026')).toBeLessThan(mail.html.indexOf('20/10/2026'));
    expect(mail.html).toContain('href="https://intra.example/#visitas"');

    const empty = buildVisitsEmail([], period);
    expect(empty.html).toContain('Nenhuma visita registrada neste mês.');
    expect(empty.html).toContain('01/10/2026 a 31/10/2026');
  });
});
