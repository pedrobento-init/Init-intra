import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// As quatro se autenticam por segredo próprio, então auth: "none" é explícito
// e a validação continua no handler. O que este teste impede é o retorno do
// padrão legado: serve() + client criado à mão com a service role.
const fnDir = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
const fonte = (nome) => fs.readFileSync(path.join(fnDir, nome, 'index.ts'), 'utf8');

const MIGRADAS = ['agenda-ics', 'avisos-prazo', 'google-agenda', 'robo'];

describe('functions no padrão @supabase/server', () => {
  it.each(MIGRADAS)('%s usa withSupabase com auth none', (nome) => {
    const src = fonte(nome);
    expect(src).toMatch(/withSupabase\(\s*\{\s*auth:\s*["']none["']\s*\}/);
    expect(src).not.toMatch(/deno\.land\/std/);
    expect(src).not.toMatch(/createClient\(\s*SUPABASE_URL/);
    // Sem estas duas, uma volta parcial ao legado passa: `Deno.serve` com o
    // client novo por dentro, ou o wrapper sem usar o admin que ele entrega.
    expect(src).not.toMatch(/\bDeno\.serve\b/);
    expect(src).toMatch(/\bctx\.supabaseAdmin\b/);
  });

  // A ordem é o que separa "autentica" de "autentica depois de consultar".
  // No padrão antigo o guard estrutural conferia isso linha a linha; aqui a
  // checagem é dentro do handler, então a posição relativa ainda importa: o
  // admin nem pode ser referenciado antes do segredo.
  it.each(['avisos-prazo', 'google-agenda', 'robo'])(
    '%s checa o segredo antes de tocar no admin',
    (nome) => {
      const src = fonte(nome);
      const inicio = src.indexOf('async function handle');
      expect(inicio).toBeGreaterThan(-1);
      const corpo = src.slice(inicio);
      expect(corpo.indexOf('safeEqual(')).toBeGreaterThan(-1);
      expect(corpo.indexOf('safeEqual(')).toBeLessThan(corpo.indexOf('ctx.supabaseAdmin'));
    }
  );

  it('agenda-ics valida o token antes de tocar no admin', () => {
    const src = fonte('agenda-ics');
    const corpo = src.slice(src.indexOf('async function handle'));
    expect(corpo.indexOf('searchParams.get("t")')).toBeGreaterThan(-1);
    expect(corpo.indexOf('searchParams.get("t")')).toBeLessThan(corpo.indexOf('ctx.supabaseAdmin'));
  });
});
