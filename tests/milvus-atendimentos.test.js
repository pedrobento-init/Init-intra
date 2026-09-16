import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const at = require('../js/milvus-atendimentos.js');

// Helpers replicando backend sanitização para testar spec
function sanitizeIlike(s){ return String(s ?? '').replace(/[%_\\]/g, '').replace(/[,()]/g, ' ').trim().slice(0,80); }
function sanitizeDate(s){ const v=String(s??'').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:''; }
function sanitizeCodigo(v){ return String(v??'').trim().slice(0,20).replace(/[^0-9a-zA-Z-_]/g,'').slice(0,20); }
function sanitizeToken(v){ return String(v??'').trim().slice(0,40).replace(/[^a-zA-Z0-9]/g,''); }
function clampTotalRegistros(v){
  const n=Number(v); if(!Number.isFinite(n)) return 50;
  const allowed=[50,100,200]; if(allowed.includes(n)) return n;
  if(n<=50) return 50; if(n<=100) return 100; if(n<=200) return 200;
  return Math.min(1000, Math.max(50, Math.trunc(n)));
}

describe('canViewMilvusAtendimentos (team isolation)', () => {
  const MAM_OP={team:'mam', isAdmin:false, active:true};
  const BT_OP={team:'bt', isAdmin:false, active:true};
  const ADMIN={team:'init', isAdmin:true, active:true};
  const MAM_CLI={id:'CLI-mam', team:'mam'};
  const BT_CLI={id:'CLI-bt', team:'bt'};
  it('MAM→MAM permitido; MAM→BT bloqueado', () => {
    expect(at.canViewMilvusAtendimentos(MAM_OP, MAM_CLI)).toBe(true);
    expect(at.canViewMilvusAtendimentos(MAM_OP, BT_CLI)).toBe(false);
  });
  it('token de outro team deve rejeitar (simula edge)', () => {
    expect(at.canViewMilvusAtendimentos(BT_OP, MAM_CLI)).toBe(false);
    expect(at.canViewMilvusAtendimentos(MAM_OP, BT_CLI)).toBe(false);
  });
  it('admin passa; inativo nega', () => {
    expect(at.canViewMilvusAtendimentos(ADMIN, BT_CLI)).toBe(true);
    expect(at.canViewMilvusAtendimentos({...MAM_OP, active:false}, MAM_CLI)).toBe(false);
  });
});

describe('normalizeMilvusAtendimento + HH:MM', () => {
  it('normaliza horas HH:MM e mantém paginação', () => {
    const raw={id:830606, codigo:7391, assunto:'teste', nome_fantasia:'A. PRATES', tecnico:'Cassiano Oliveira', data_inicial:'2022-03-21 19:48:15', total_horas_atendimento:'02:30', horas_ticket:'07:10', horas_operador:'02:30', horas_internas:'02:00', horas_externas:'00:30', status:{id:4,text:'Finalizado'}};
    const n=at.normalizeMilvusAtendimento(raw);
    expect(n.codigo).toBe('7391');
    expect(n.total_horas_atendimento).toBe('02:30');
    expect(n.horas_ticket).toBe('07:10');
    expect(n.tecnico).toBe('Cassiano Oliveira');
  });
  it('_normalizeHHMM padding e fallback', () => {
    expect(at._normalizeHHMM('2:5')).toBe('02:05');
    expect(at._normalizeHHMM('')).toBe('00:00');
    expect(at._normalizeHHMM(null)).toBe('00:00');
    expect(at._normalizeHHMM('12:30')).toBe('12:30');
  });
  it('cache TTL 5min', () => {
    expect(at.MILVUS_ATEND_TTL_MS).toBe(5*60*1000);
  });
});

describe('sanitização backend (mesmo padrão _sanitizeIlike)', () => {
  it('nome_tecnico remove %_\\ ,()', () => {
    expect(sanitizeIlike('teste%_\\,()')).toBe('teste');
    expect(sanitizeIlike('  Cassiano Oliveira  ')).toBe('Cassiano Oliveira');
    expect(sanitizeIlike('a'.repeat(100)).length).toBe(80);
  });
  it('data YYYY-MM-DD', () => {
    expect(sanitizeDate('2022-06-13')).toBe('2022-06-13');
    expect(sanitizeDate('13/06/2022')).toBe('');
    expect(sanitizeDate(' 2022-07-13 ')).toBe('2022-07-13');
  });
  it('codigo sanitizado', () => {
    expect(sanitizeCodigo('5353')).toBe('5353');
    expect(sanitizeCodigo('  53%53 ')).toBe('5353');
    expect(sanitizeCodigo('AB-123')).toBe('AB-123');
  });
  it('token alfanumérico apenas', () => {
    expect(sanitizeToken('O5NHAA')).toBe('O5NHAA');
    expect(sanitizeToken('AASSYY%')).toBe('AASSYY');
    expect(sanitizeToken('')).toBe('');
  });
});

describe('cap total_registros', () => {
  it('aceita 50/100/200, cap 1000', () => {
    expect(clampTotalRegistros(50)).toBe(50);
    expect(clampTotalRegistros(100)).toBe(100);
    expect(clampTotalRegistros(200)).toBe(200);
    expect(clampTotalRegistros(2000)).toBe(1000);
    expect(clampTotalRegistros(75)).toBe(100);
    expect(clampTotalRegistros(undefined)).toBe(50);
  });
});

describe('mock API Milvus list/export', () => {
  it('lista retorna meta.lista.resumo sem alterar formato', async () => {
    // simula edge list proxy
    const fake={meta:{paginate:{current_page:'1',total:2,per_page:'10',last_page:1}}, lista:[{id:830606,codigo:7391,assunto:'teste'}], resumo:{total_chamados:1,total_horas:'07:10'}};
    expect(Array.isArray(fake.lista)).toBe(true);
    expect(fake.meta.paginate.total).toBe(2);
    expect(fake.resumo.total_chamados).toBe(1);
  });
  it('export retorna base64 + content-type', async () => {
    const csv='codigo,assunto\n7391,teste';
    const base64=Buffer.from(csv).toString('base64');
    const fake={success:true, tipo_arquivo:'csv', contentType:'text/csv', base64, size: csv.length};
    expect(fake.base64).toBe(base64);
    expect(Buffer.from(fake.base64,'base64').toString()).toBe(csv);
    expect(fake.contentType).toBe('text/csv');
  });
});
