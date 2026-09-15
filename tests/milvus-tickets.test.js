import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tk = require('../js/milvus-tickets.js');

const MAM_OP = { team: 'mam', isAdmin: false, active: true };
const BT_OP = { team: 'bt', isAdmin: false, active: true };
const ADMIN_OP = { team: 'init', isAdmin: true, active: true };
const MAM_CLI = { id: 'CLI-mam', team: 'mam' };
const BT_CLI = { id: 'CLI-bt', team: 'bt' };

const RAW = {
  id: 38049435,
  codigo: 25642,
  assunto: 'Reset de e-mail | Unidade',
  descricao: 'Unidade: João Dias | Solicitante: Emanuelle Moro',
  status: 'Finalizado',
  prioridade: null,
  categoria_primaria: 'E-mail',
  categoria_secundaria: 'Login',
  tecnico: 'Pedro Bento',
  data_criacao: '2026-09-10 13:49:52',
  data_modificacao: '2026-09-10 13:51:41',
  data_solucao: '2026-09-10 13:51:41',
  ultima_log: {
    texto: 'E-mail resetado para a unidade João Dias.',
    texto_html: '<p>E-mail resetado para a unidade João Dias.</p>',
    data: '2026-09-10 13:51:41',
    tecnico: 'Pedro Bento',
  },
  // Campos que NUNCA devem ser persistidos:
  contato: 'João',
  email_conferencia: 'x@y.com',
  telefone: '119999',
  email_tecnico: 't@t.com',
  cliente_cpf_cnpj: '19033684000156',
  cliente_token: 'ABC123',
  descricao_avaliacao: 'ótimo',
  total_avaliacao: 5,
  ultimas_cinco_logs: [{ texto: 'a' }],
  dispositivo_vinculado: 1,
};

describe('canViewMilvusTickets (mesma regra operador→equipe→cliente)', () => {
  it('MAM→MAM permitido; MAM→BT bloqueado', () => {
    expect(tk.canViewMilvusTickets(MAM_OP, MAM_CLI)).toBe(true);
    expect(tk.canViewMilvusTickets(MAM_OP, BT_CLI)).toBe(false);
  });
  it('BT→BT permitido; BT→MAM bloqueado', () => {
    expect(tk.canViewMilvusTickets(BT_OP, BT_CLI)).toBe(true);
    expect(tk.canViewMilvusTickets(BT_OP, MAM_CLI)).toBe(false);
  });
  it('admin mantém acesso; inativo/sem dados nega (fail-closed)', () => {
    expect(tk.canViewMilvusTickets(ADMIN_OP, MAM_CLI)).toBe(true);
    expect(tk.canViewMilvusTickets(ADMIN_OP, BT_CLI)).toBe(true);
    expect(tk.canViewMilvusTickets({ ...MAM_OP, active: false }, MAM_CLI)).toBe(false);
    expect(tk.canViewMilvusTickets(null, MAM_CLI)).toBe(false);
    expect(tk.canViewMilvusTickets(MAM_OP, null)).toBe(false);
  });
});

describe('normalizeMilvusTicket (linha real do Milvus)', () => {
  it('mapeia campos da tela compacta + datas + última log', () => {
    const t = tk.normalizeMilvusTicket(RAW, 'CLI-1', 'mam');
    expect(t.id).toBe('CLI-1:ticket-38049435');
    expect(t.milvus_ticket_id).toBe(38049435);
    expect(t.codigo).toBe(25642);
    expect(t.assunto).toBe('Reset de e-mail | Unidade');
    expect(t.status).toBe('Finalizado');
    expect(t.prioridade).toBe('');
    expect(t.categoria_primaria).toBe('E-mail');
    expect(t.tecnico).toBe('Pedro Bento');
    expect(t.data_criacao.startsWith('2026-09-10')).toBe(true);
    expect(t.data_solucao.startsWith('2026-09-10')).toBe(true);
    expect(t.ultima_log.texto).toBe('E-mail resetado para a unidade João Dias.');
    expect(t.ultima_log.tecnico).toBe('Pedro Bento');
  });
  it('NUNCA carrega contato/e-mails/telefone/CPF/token/avaliações/HTML/logs extras/dispositivo', () => {
    const t = tk.normalizeMilvusTicket(RAW, 'CLI-1', 'mam');
    const s = JSON.stringify(t);
    expect(s).not.toContain('x@y.com');
    expect(s).not.toContain('119999');
    expect(s).not.toContain('19033684000156');
    expect(s).not.toContain('ABC123');
    expect(s).not.toContain('ótimo');
    expect(s).not.toContain('<p>');
    expect(s).not.toContain('ultimas_cinco_logs');
    expect(s).not.toContain('dispositivo_vinculado');
    expect(Object.keys(t).sort()).toEqual([
      'assunto', 'categoria_primaria', 'categoria_secundaria', 'client_id', 'codigo',
      'data_criacao', 'data_modificacao', 'data_solucao', 'descricao', 'id',
      'milvus_ticket_id', 'prioridade', 'status', 'team', 'tecnico', 'ultima_log',
    ].sort());
  });
  it('null-safe: sem id descarta; nulos viram vazio/null', () => {
    expect(tk.normalizeMilvusTicket({ assunto: 'x' }, 'CLI-1', 'mam')).toBeNull();
    expect(tk.normalizeMilvusTicket(null, 'CLI-1', 'mam')).toBeNull();
    const t = tk.normalizeMilvusTicket({ id: 1, codigo: 5 }, 'CLI-1', 'mam');
    expect(t.assunto).toBe('');
    expect(t.data_solucao).toBeNull();
    expect(t.ultima_log).toBeNull();
  });
  it('datas inválidas viram null', () => {
    const t = tk.normalizeMilvusTicket({ id: 1, data_criacao: 'quando?' }, 'CLI-1', 'mam');
    expect(t.data_criacao).toBeNull();
  });
});

describe('topMilvusTickets + staleMilvusTicketIds (teto de 10, prune por cliente)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ milvus_ticket_id: i + 1, codigo: 100 + i }));
  it('corta nos 10 maiores códigos', () => {
    const top = tk.topMilvusTickets(rows);
    expect(top).toHaveLength(10);
    expect(top[0].codigo).toBe(111);
    expect(top[9].codigo).toBe(102);
  });
  it('menos de 10: mostra só os existentes', () => {
    expect(tk.topMilvusTickets(rows.slice(0, 3))).toHaveLength(3);
    expect(tk.topMilvusTickets([])).toEqual([]);
  });
  it('stale = existentes fora do top (escopo do chamador = 1 cliente)', () => {
    const keep = tk.topMilvusTickets(rows).map((r) => r.milvus_ticket_id);
    expect(tk.staleMilvusTicketIds(rows.map((r) => r.milvus_ticket_id), keep)).toEqual([1, 2]);
    expect(tk.staleMilvusTicketIds([1, 2], [1, 2])).toEqual([]);
  });
  it('re-sync com os mesmos 10: nada stale, nada duplica', () => {
    const top = tk.topMilvusTickets(rows);
    const keep = top.map((r) => r.milvus_ticket_id);
    expect(tk.staleMilvusTicketIds(keep, keep)).toEqual([]);
    const again = tk.topMilvusTickets(top.concat(top));
    expect(again).toHaveLength(10);
  });
});

describe('shouldAutoSyncMilvusTickets (sem chamada a cada render)', () => {
  const H = 3600000;
  it('nunca sincronizado ou inválido → sincroniza', () => {
    expect(tk.shouldAutoSyncMilvusTickets(null, 0)).toBe(true);
    expect(tk.shouldAutoSyncMilvusTickets('lixo', 0)).toBe(true);
  });
  it('recente (<60min) → não; antigo (>60min) → sim', () => {
    const now = 100 * H;
    expect(tk.shouldAutoSyncMilvusTickets(new Date(now - 10 * 60000).toISOString(), now)).toBe(false);
    expect(tk.shouldAutoSyncMilvusTickets(new Date(now - 61 * 60000).toISOString(), now)).toBe(true);
  });
});
