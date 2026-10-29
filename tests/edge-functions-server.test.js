import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// As quatro se autenticam por segredo próprio, então auth: "none" é explícito
// e a validação continua no handler. O que este teste impede é o retorno do
// padrão legado: serve() + client criado à mão com a service role.
const fnDir = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
const fonte = (nome) => fs.readFileSync(path.join(fnDir, nome, 'index.ts'), 'utf8');

const MIGRADAS = ['agenda-ics', 'avisos-prazo', 'google-agenda'];

describe('functions no padrão @supabase/server', () => {
  it.each(MIGRADAS)('%s usa withSupabase com auth none', (nome) => {
    const src = fonte(nome);
    expect(src).toMatch(/withSupabase\(\s*\{\s*auth:\s*["']none["']\s*\}/);
    expect(src).not.toMatch(/deno\.land\/std/);
    expect(src).not.toMatch(/createClient\(\s*SUPABASE_URL/);
  });
});
