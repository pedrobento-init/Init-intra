import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Aviso de @menção (js/notifications.js). O que não pode quebrar:
//   * quem foi marcado recebe o próprio aviso, e não o mesmo texto duas vezes;
//   * a regra de quem vê é a do RLS (can_see_pendencia): Gestão só para Gestão,
//     o resto para admin ou mesma equipe — marcar alguém de fora não vaza o título;
//   * quem escreveu não avisa a si mesmo.

const _escape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const OPS = [
  { name: 'Ana Souza', email: 'ana@x.com', team: 'init', active: true },
  { name: 'Felipe Lima', email: 'felipe@x.com', team: 'init', active: true, isGestao: true },
  { name: 'Beto Reis', email: 'beto@x.com', team: 'init', active: true },
  { name: 'Caio Mam', email: 'caio@x.com', team: 'mam', active: true },
  { name: 'Duda Admin', email: 'duda@x.com', team: 'mam', active: true, isAdmin: true },
  { name: 'Eva Inativa', email: 'eva@x.com', team: 'init', active: false },
  { name: 'Gil Sem Email', email: '', team: 'init', active: true },
];

function criarSandbox() {
  const prefs = {};
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    SUPABASE_URL: 'https://projeto.supabase.co',
    escapeHtml: _escape,
    window: { location: { origin: 'https://intra.test', pathname: '/' }, addEventListener() {} },
    document: { addEventListener() {}, getElementById: () => null },
    localStorage: { getItem: (k) => (k in prefs ? prefs[k] : null), setItem: (k, v) => { prefs[k] = String(v); } },
    getOperators: () => OPS,
    isPendenciaGestao: (p) => /^gest[aã]o$/i.test(String((p && p.tipo) || '')),
    isGestaoOperator: (o) => !!o && o.active !== false && o.isGestao === true,
    getPendenciaTitulo: (p) => p.assunto || 'Sem assunto',
    penPaginaHash: (p) => 'chamados/' + p.id,
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync('js/notifications.js', 'utf8'), sb, { filename: 'notifications.js' });
  return sb;
}

const sb = criarSandbox();
let emails;
let pushes;

const pen = (extra) => ({ id: 'P1', assunto: 'Impressora parada', responsible: 'Ana Souza', team: 'init', tipo: 'Suporte', ...extra });
const nota = (texto, mencionados, autor = 'Beto Reis') => ({
  text: texto, author: autor, createdAt: '2026-11-04T12:00:00.000Z', mentionedOperators: mencionados, visibility: 'interna',
});

beforeEach(() => {
  emails = [];
  pushes = [];
  sb.sendEmailNotification = (m) => { emails.push(m); return Promise.resolve({ success: true }); };
  sb.sendPushNotification = (m) => { pushes.push(m); return Promise.resolve({ success: true }); };
  sb.localStorage.setItem('intra_notif_prefs', JSON.stringify({ onPendenciaCreate: true, onPendenciaUpdate: true, onPendenciaNote: true }));
});

describe('collectMentionRecipients', () => {
  it('marcado da mesma equipe entra', () => {
    expect(sb.collectMentionRecipients(pen(), nota('@Felipe', ['Felipe Lima']))).toEqual(['felipe@x.com']);
  });

  it('quem escreveu não avisa a si mesmo', () => {
    expect(sb.collectMentionRecipients(pen(), nota('@Beto', ['Beto Reis'], 'Beto Reis'))).toEqual([]);
  });

  it('de outra equipe só entra se for admin', () => {
    expect(sb.collectMentionRecipients(pen(), nota('@Caio @Duda', ['Caio Mam', 'Duda Admin']))).toEqual(['duda@x.com']);
  });

  it('pendência de Gestão: só quem é Gestão, nem admin de fora', () => {
    const r = sb.collectMentionRecipients(pen({ tipo: 'Gestão' }), nota('@Felipe @Ana @Duda', ['Felipe Lima', 'Ana Souza', 'Duda Admin']));
    expect(r).toEqual(['felipe@x.com']);
  });

  it('inativo ou sem e-mail fica de fora', () => {
    expect(sb.collectMentionRecipients(pen(), nota('@Eva @Gil', ['Eva Inativa', 'Gil Sem Email']))).toEqual([]);
  });

  it('nota sem menção (ou antiga, sem o campo) não avisa ninguém', () => {
    expect(sb.collectMentionRecipients(pen(), { text: 'oi', author: 'Ana Souza' })).toEqual([]);
  });
});

describe('notifyPendenciaNote com menção', () => {
  it('o marcado recebe "Você foi mencionado" com link direto, e sai do aviso geral', () => {
    sb.notifyPendenciaNote(pen(), nota('@Felipe olha isso', ['Felipe Lima']));
    const mencao = emails.find((m) => m.subject.indexOf('Você foi mencionado') !== -1);
    expect(mencao.to).toEqual(['felipe@x.com']);
    expect(mencao.subject).toBe('[Init Intra] Você foi mencionado em: Impressora parada');
    expect(mencao.html).toContain('https://intra.test/#chamados/P1');
    const geral = emails.find((m) => m.subject.indexOf('Nova nota') !== -1);
    expect(geral.to).toContain('ana@x.com');
    expect(geral.to).not.toContain('felipe@x.com');
    expect(pushes.find((m) => m.title.indexOf('Você foi mencionado') === 0)).toMatchObject({ to: ['felipe@x.com'], url: '#chamados/P1' });
  });

  it('marcar o responsável: ele recebe só o aviso de menção, não os dois', () => {
    sb.notifyPendenciaNote(pen(), nota('@Ana confere?', ['Ana Souza']));
    const paraAna = emails.filter((m) => m.to.includes('ana@x.com'));
    expect(paraAna.map((m) => m.subject)).toEqual(['[Init Intra] Você foi mencionado em: Impressora parada']);
    expect(pushes.filter((m) => m.to.includes('ana@x.com'))).toHaveLength(1);
  });

  it('menção sai mesmo com o aviso geral de nota desligado', () => {
    sb.localStorage.setItem('intra_notif_prefs', JSON.stringify({ onPendenciaNote: false }));
    sb.notifyPendenciaNote(pen(), nota('@Felipe', ['Felipe Lima']));
    expect(emails.map((m) => m.to)).toEqual([['felipe@x.com']]);
  });

  it('sem menção, o aviso geral segue como antes e ninguém recebe "mencionado"', () => {
    sb.notifyPendenciaNote(pen(), nota('só uma nota', []));
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe('[Init Intra] Nova nota em: Impressora parada');
    expect(pushes.some((m) => m.title.indexOf('Você foi mencionado') === 0)).toBe(false);
  });

  it('escapa o texto e o autor da nota no e-mail', () => {
    sb.notifyPendenciaNote(pen(), nota('<img src=x onerror=alert(1)> @Felipe', ['Felipe Lima'], '<b>Beto</b>'));
    const html = emails[0].html;
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>Beto</b>');
    expect(html).toContain('&lt;img src=x');
  });
});
