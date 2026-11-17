import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Apagar o histórico é só de admin e não pode "limpar só o cache" quando o servidor falha;
// e todo delete/update remoto do cliente precisa de filtro (AGENTS.md: sem filtro é bug de segurança).

const src = fs.readFileSync('js/ui.js', 'utf8');
const fn = src.match(/async function clearAuditLogs\(\) \{[\s\S]*?\n\}/)[0];
const build = (env) =>
  new Function(...Object.keys(env), fn + '\nreturn clearAuditLogs;')(...Object.values(env));

describe('clearAuditLogs (apagar todo o histórico)', () => {
  let calls, cleared, remote;
  const mk = ({ admin, hasClient = true, authActive = true } = {}) => {
    const q = {
      delete: () => { calls.push(['delete']); return q; },
      not: (...a) => { calls.push(['not', ...a]); return Promise.resolve(remote()); },
      gte: () => { calls.push(['gte']); return Promise.resolve({ error: null }); },
    };
    return build({
      isCurrentAdmin: () => admin,
      supabaseClient: hasClient ? { from: (t) => { calls.push(['from', t]); return q; } } : null,
      window: { _supabaseAuthActive: authActive },
      setCacheTable: (t, v) => { cleared.push([t, v]); },
      dbSet: () => { throw new Error('não deveria cair no dbSet'); },
      DB: { LOGS: 'logs' },
      console: { warn() {} },
    });
  };
  beforeEach(() => { calls = []; cleared = []; remote = () => ({ error: null }); });

  it('não-admin: recusa antes de qualquer chamada remota ou limpeza local', async () => {
    const r = await mk({ admin: false })();
    expect(r).toEqual({ ok: false, reason: 'forbidden' });
    expect(calls).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('admin: apaga no servidor (com filtro explícito) e só depois limpa o cache', async () => {
    const r = await mk({ admin: true })();
    expect(r.ok).toBe(true);
    expect(calls).toEqual([['from', 'audit_logs'], ['delete'], ['not', 'id', 'is', null]]);
    expect(cleared).toEqual([['audit_logs', []]]);
  });

  it('falha remota (erro do Supabase): cache local fica intacto', async () => {
    remote = () => ({ error: { message: 'RLS' } });
    const r = await mk({ admin: true })();
    expect(r).toEqual({ ok: false, reason: 'remote' });
    expect(cleared).toEqual([]);
  });

  it('falha de rede (exceção): cache local fica intacto', async () => {
    remote = () => { throw new Error('rede'); };
    const r = await mk({ admin: true })();
    expect(r).toEqual({ ok: false, reason: 'remote' });
    expect(cleared).toEqual([]);
  });

  it('servidor configurado mas sessão não autenticada: recusa em vez de limpar só o local', async () => {
    const r = await mk({ admin: true, authActive: false })();
    expect(r).toEqual({ ok: false, reason: 'offline' });
    expect(calls).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('modo local (sem Supabase): limpa o cache', async () => {
    const r = await mk({ admin: true, hasClient: false })();
    expect(r.ok).toBe(true);
    expect(cleared).toEqual([['audit_logs', []]]);
  });

  it('botão "Limpar Histórico" só é renderizado para admin', () => {
    expect(src).toMatch(/isCurrentAdmin\(\) \? '<button[^']*data-action="clearLogs"/);
  });
});

describe('delete/update remotos do cliente têm filtro', () => {
  const walk = (d) => fs.readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
  const filtro = /\.(eq|in|not|match|neq|gte|lte|lt|gt|like|ilike|is)\(/;

  it('toda cadeia supabaseClient...delete()/update() leva um filtro', () => {
    const sem = [];
    let vistos = 0;
    for (const f of walk('js')) {
      const code = fs.readFileSync(f, 'utf8');
      const re = /supabaseClient[^;]{0,400}?\.(delete\(\)|update\()/g;
      let m;
      while ((m = re.exec(code))) {
        vistos++;
        const resto = code.slice(m.index).split(';')[0];
        if (!filtro.test(resto)) sem.push(f + ': ' + code.slice(0, m.index).split('\n').length);
      }
    }
    expect(vistos).toBeGreaterThan(15); // o scanner está de fato achando as cadeias
    expect(sem).toEqual([]);
  });

  it('delete de audit_logs não usa mais o filtro mágico de timestamp', () => {
    expect(src).not.toMatch(/gte\('timestamp',\s*'1970/);
  });

  it('migração de status legado só atualiza no servidor os ids locais', () => {
    const st = fs.readFileSync('js/storage.js', 'utf8');
    expect(st).toMatch(/update\(\{ status: 'resolvido'[^)]*\)\.in\('id', idsByTo\.resolvido\)/);
    expect(st).toMatch(/update\(\{ status: 'cancelado'[^)]*\)\.in\('id', idsByTo\.cancelado\)/);
  });
});
