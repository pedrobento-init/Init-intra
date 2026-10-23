import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guarda estrutural da pendencia-responder, no mesmo espírito de
// tests/edge-functions-guard.test.js: o vitest não roda Deno, então o que dá
// para travar é o invariante que torna a função segura.
//
// O invariante: o app manda `pendencia_id`, nunca um destinatário. Se um dia
// alguém aceitar `to` do corpo da requisição, a chave pública que vai no site
// vira um relay de e-mail em nome do domínio — que é exatamente a razão de a
// send-email só aceitar operador ativo.

const src = fs.readFileSync(
  fileURLToPath(new URL('../supabase/functions/pendencia-responder/index.ts', import.meta.url)),
  'utf8',
);

describe('pendencia-responder: o destinatário nunca vem do app', () => {
  it('o corpo da requisição só traz pendencia_id e text', () => {
    const destruct = /const\s*\{([^}]*)\}\s*=\s*await\s+req\.json\(\)/.exec(src);
    expect(destruct, 'não achei a leitura do corpo da requisição').not.toBeNull();
    const campos = destruct[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
    expect(campos).toEqual(['pendencia_id', 'text']);
  });

  it('o endereço sai do chamado, lido com a chave de serviço', () => {
    expect(src).toMatch(/supabaseAdmin[\s\S]*?from\("pendencias"\)/);
    expect(src).toMatch(/solicitante_email/);
    expect(src).toMatch(/const\s+destino\s*=\s*String\(pen\.solicitante_email/);
    expect(src).toMatch(/to:\s*destino\b/);
  });

  it('sem endereço no chamado, não manda nada', () => {
    expect(src).toContain('no_requester_email');
  });
});

describe('pendencia-responder: quem pode chamar', () => {
  it('exige operador ativo logado, como a send-email', () => {
    expect(src).toMatch(/withSupabase\(\s*\{\s*auth:\s*"user"\s*\}/);
    expect(src).toMatch(/from\("operators"\)/);
    expect(src).toContain('unauthorized');
  });
});

describe('pendencia-responder: mesma conversa', () => {
  it('devolve o Message-ID guardado em In-Reply-To e References', () => {
    expect(src).toMatch(/inReplyTo:\s*refId/);
    expect(src).toMatch(/references:\s*\[refId\]/);
  });

  it('sem Message-ID o e-mail sai assim mesmo, avisando que não ficou na conversa', () => {
    expect(src).toMatch(/threaded:\s*!!refId/);
  });
});
