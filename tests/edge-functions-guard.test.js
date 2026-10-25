import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Rede de segurança das Edge Functions. Elas guardam o MILVUS_API_TOKEN e
// fazem o team-check antes de escrever com service role — e não têm teste de
// integração, porque o vitest não resolve os imports `https://deno.land/...`
// e o projeto não usa Deno localmente. Então o que dá para travar é o
// invariante estrutural, no mesmo espírito de tests/cdn-sri.test.js.
//
// Regressão principal: o config.toml cobria 6 das 17 functions; as outras 11
// dependiam da última opção usada no deploy (`--no-verify-jwt` fica grudado,
// deixando a função aberta). Ver commit da Fase 0.

const fnDir = fileURLToPath(new URL('../supabase/functions/', import.meta.url));
const configToml = fs.readFileSync(
  fileURLToPath(new URL('../supabase/config.toml', import.meta.url)),
  'utf8',
);

// Uma function é um diretório com index.ts (os demais são módulos
// compartilhados, ex.: send-push/payload.ts importado por avisos-prazo).
const functions = fs
  .readdirSync(fnDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(fnDir, e.name, 'index.ts')))
  .map((e) => ({ name: e.name, source: fs.readFileSync(path.join(fnDir, e.name, 'index.ts'), 'utf8') }));

// [functions.<nome>] seguido de verify_jwt = true|false (config.toml é CRLF).
function verifyJwtOf(name) {
  const re = new RegExp(`\\[functions\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*verify_jwt\\s*=\\s*(true|false)`);
  const m = re.exec(configToml);
  return m ? m[1] === 'true' : null;
}

// Como a function autentica quem chamou. Exatamente um destes deve valer.
// Dois padrões convivem durante a migração para @supabase/server (Fase 2):
// o legado valida o JWT na mão (`admin.auth.getUser`), o novo declara
// `withSupabase({ auth: "user" })` e o wrapper verifica antes do handler.
function authMode(source) {
  if (/withSupabase\(\s*\{[^}]*auth:\s*["']user["']/.test(source)) return 'jwt';
  if (/auth\.getUser\(/.test(source)) return 'jwt';
  if (/x-[a-z-]*secret/.test(source)) return 'secret-header';
  // Webhook de fora (Meta): o provedor assina o corpo e a function confere o
  // HMAC antes de ler o payload. Vem ANTES do query-token porque o handshake
  // de cadastro também lê searchParams, e ali a query não autentica nada.
  if (/assinaturaValida\(/.test(source)) return 'assinatura';
  if (/searchParams\.get\(/.test(source)) return 'query-token';
  return 'nenhum';
}

// Escreve com privilégio elevado? No legado é o SERVICE_ROLE_KEY lido do env;
// no novo é o ctx.supabaseAdmin que o withSupabase entrega pronto.
function usaServiceRole(source) {
  return /Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/.test(source) ||
    /\bsupabaseAdmin\b/.test(source);
}

const SEGREDOS = ['MILVUS_API_TOKEN', 'SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

describe('config.toml declara verify_jwt de TODA Edge Function', () => {
  it('há functions para validar', () => {
    expect(functions.length).toBeGreaterThanOrEqual(17);
  });

  it('nenhuma function fica sem verify_jwt explícito', () => {
    for (const f of functions) {
      expect(verifyJwtOf(f.name), `[functions.${f.name}] ausente ou sem verify_jwt`).not.toBeNull();
    }
  });

  it('não há entrada órfã apontando para function que não existe', () => {
    const declaradas = [...configToml.matchAll(/\[functions\.([a-z0-9-]+)\]/g)].map((m) => m[1]);
    const existentes = new Set(functions.map((f) => f.name));
    for (const nome of declaradas) {
      expect(existentes.has(nome), `[functions.${nome}] não tem diretório com index.ts`).toBe(true);
    }
  });
});

describe('verify_jwt coerente com o modo de autenticação', () => {
  it('quem valida JWT do operador exige verify_jwt = true', () => {
    const jwt = functions.filter((f) => authMode(f.source) === 'jwt');
    expect(jwt.length).toBeGreaterThanOrEqual(13);
    for (const f of jwt) {
      expect(verifyJwtOf(f.name), `${f.name} chama auth.getUser mas não exige JWT na plataforma`).toBe(true);
    }
  });

  it('quem se autentica por segredo próprio usa verify_jwt = false', () => {
    // robô do Apps Script (x-agenda-secret), cron do banco (x-cron-secret) e
    // o feed .ics (token na query, porque app de calendário não manda header) e
    // o webhook do WhatsApp (assinatura HMAC da Meta sobre o corpo cru).
    const proprio = functions.filter((f) => ['secret-header', 'query-token', 'assinatura'].includes(authMode(f.source)));
    expect(proprio.map((f) => f.name).sort()).toEqual(['agenda-ics', 'avisos-prazo', 'google-agenda', 'robo', 'whatsapp']);
    for (const f of proprio) {
      expect(verifyJwtOf(f.name), `${f.name} não valida JWT; verify_jwt deveria ser false`).toBe(false);
    }
  });

  it('nenhuma function fica sem forma alguma de autenticar o chamador', () => {
    for (const f of functions) {
      expect(authMode(f.source), `${f.name} não autentica o chamador`).not.toBe('nenhum');
    }
  });
});

describe('higiene de segredos', () => {
  it('nenhum valor de segredo é interpolado (log, resposta ou URL)', () => {
    // O NOME numa string literal é aceitável ("MILVUS_API_TOKEN não
    // configurado"); interpolar o VALOR vazaria o segredo no log.
    for (const f of functions) {
      for (const s of SEGREDOS) {
        const re = new RegExp(`\\$\\{[^}]*${s}[^}]*\\}`);
        expect(re.test(f.source), `${f.name} interpola ${s}`).toBe(false);
      }
    }
  });

  it('o token do Milvus só vai no header Authorization', () => {
    for (const f of functions) {
      if (!f.source.includes('MILVUS_API_TOKEN')) continue;
      // Usos permitidos: comentário, leitura do env, teste de vazio,
      // string literal com o nome, e o header.
      const usos = f.source
        .split('\n')
        .map((l, i) => ({ n: i + 1, l }))
        .filter(({ l }) => /\bMILVUS_API_TOKEN\b/.test(l))
        .filter(({ l }) => !/^\s*\/\//.test(l))
        .filter(({ l }) => !/Deno\.env\.get\("MILVUS_API_TOKEN"\)/.test(l))
        .filter(({ l }) => !/if \(!MILVUS_API_TOKEN\)/.test(l))
        .filter(({ l }) => !/"[^"]*MILVUS_API_TOKEN[^"]*"\s*\)/.test(l))
        .filter(({ l }) => !/"Authorization":\s*MILVUS_API_TOKEN/.test(l));
      expect(usos.map((u) => `${f.name}:${u.n}`), `uso inesperado do token em ${f.name}`).toEqual([]);
    }
  });
});

describe('autorização antes da escrita com service role', () => {
  it('quem escreve com privilégio elevado autentica o chamador', () => {
    for (const f of functions) {
      if (!usaServiceRole(f.source)) continue;
      expect(authMode(f.source), `${f.name} escreve sem autenticar`).not.toBe('nenhum');
    }
  });

  // No padrão legado a ordem é posicional e precisa ser conferida linha a
  // linha. No withSupabase o gate roda ANTES do handler por construção, então
  // não há ordem a verificar — a garantia é estrutural, não textual.
  it('no padrão legado, o getUser vem antes da primeira escrita', () => {
    const escrita = /\.upsert\(|\.insert\(|\.update\(/;
    for (const f of functions) {
      if (!/auth\.getUser\(/.test(f.source)) continue;
      const linhas = f.source.split('\n');
      const iAuth = linhas.findIndex((l) => /auth\.getUser\(/.test(l));
      const iEscrita = linhas.findIndex((l) => escrita.test(l));
      if (iEscrita === -1) continue; // só lê — nada a ordenar
      expect(iAuth, `${f.name}: escreve (linha ${iEscrita + 1}) antes de autenticar (linha ${iAuth + 1})`)
        .toBeLessThan(iEscrita);
    }
  });
});
