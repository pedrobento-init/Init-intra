import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');
// CRLF em checkout Windows não pode mudar o resultado.
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function walk(n, cb) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) {
    n.forEach((x) => walk(x, cb));
    return;
  }
  if (n.type) cb(n);
  for (const k in n) if (k !== 'type') walk(n[k], cb);
}

// Mesmo critério do no-empty do ESLint: bloco sem instrução e sem comentário.
function emptyCatches(src) {
  const ast = acorn.parse(src, {
    ecmaVersion: 2022,
    sourceType: 'script',
    allowReturnOutsideFunction: true,
  });
  const found = [];
  walk(ast, (n) => {
    if (n.type !== 'CatchClause' || n.body.body.length) return;
    if (src.slice(n.body.start + 1, n.body.end - 1).trim() !== '') return;
    found.push(src.slice(0, n.start).split('\n').length);
  });
  return found;
}

describe('catch vazio em js/', () => {
  it('nenhum catch engole a falha sem log nem comentário', () => {
    const ruins = [];
    for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith('.js'))) {
      for (const line of emptyCatches(read(path.join(jsDir, f)))) ruins.push(`${f}:${line}`);
    }
    // Use _logSilent (js/error-log.js) ou comente por que a falha é ignorável.
    expect(ruins).toEqual([]);
  });

  it('o detector enxerga catch {} e catch (e) {} mas aceita catch comentado', () => {
    const src =
      'try { a(); } catch {}\ntry { b(); } catch (e) {\n}\ntry { c(); } catch (_) { /* ok */ }\n';
    expect(emptyCatches(src)).toEqual([1, 2]);
  });

  it('eslint mantém no-empty ligado e caughtErrors em all', () => {
    const cfg = read(path.join(root, 'eslint.config.mjs'));
    expect(cfg).not.toMatch(/'no-empty':\s*'off'/);
    expect(cfg).not.toMatch(/caughtErrors:\s*'none'/);
    expect(cfg).toMatch(/caughtErrors:\s*'all'/);
  });
});

describe('falha de push não é engolida (time-entries)', () => {
  function load() {
    const calls = { failed: 0, logged: [] };
    const ctx = {
      console,
      window: { _supabaseAuthActive: true },
      isSupabaseConnected: () => true,
      supabaseClient: {
        from() {
          throw new Error('boom');
        },
      },
      markSyncPushFailed: () => {
        calls.failed++;
      },
      _logSilent: (_e, where) => {
        calls.logged.push(where);
      },
      DB: { TIME_ENTRIES: 'time_entries' },
      dbGet: () => [],
      dbSet: () => {},
      _addTombstone: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(
      read(path.join(jsDir, 'time-entries.js')) + '\nthis.deleteTimeEntry = deleteTimeEntry;',
      ctx
    );
    return { ctx, calls };
  }

  it('deleteTimeEntry: exceção síncrona do client conta como push pendente e é registrada', () => {
    const { ctx, calls } = load();
    expect(() => ctx.deleteTimeEntry('TE-1')).not.toThrow();
    expect(calls.failed).toBe(1);
    expect(calls.logged).toEqual(['time-entries:delete']);
  });

  it('deleteTimeEntry: o catch não lança sem _logSilent nem markSyncPushFailed', () => {
    const { ctx } = load();
    delete ctx.markSyncPushFailed;
    delete ctx._logSilent;
    expect(() => ctx.deleteTimeEntry('TE-1')).not.toThrow();
  });
});
