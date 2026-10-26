import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// O deploy das Edge Functions é a metade do projeto que não tem como a Vercel
// cobrir, e a que já falhou calada: front novo no ar chamando função antiga.
// O workflow conserta isso, e estes testes trancam o que, errado nele, volta a
// quebrar em silêncio — no mesmo espírito de edge-functions-guard.test.js.
//
// Windows grava CRLF; normaliza antes de comparar texto (ver rls-055).
const ler = (p) => fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const workflow = ler('../.github/workflows/deploy-functions.yml');
const configToml = ler('../supabase/config.toml');

// O invariante é sobre o que o workflow FAZ. O cabeçalho dele explica por que
// --no-verify-jwt é proibido, e citar a opção para proibi-la não pode derrubar
// o teste que a proíbe.
const comandos = workflow
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('workflow de deploy das Edge Functions', () => {
  it('existe e roda no merge para a main', () => {
    expect(workflow).toMatch(/branches:\s*\[main\]/);
    expect(workflow).toMatch(/supabase functions deploy/);
  });

  it('nunca passa --no-verify-jwt', () => {
    // A opção fica grudada na função no servidor: um deploy assim abre a
    // função para sempre, e no CI abriria as 18 de uma vez, sem ninguém ver.
    expect(comandos).not.toMatch(/--no-verify-jwt/);
  });

  it('deploya o lote inteiro, sem listar função por função', () => {
    // Lista no workflow envelhece: function nova entra no repositório, não
    // entra na lista e nunca é publicada. `deploy` sem nome manda todas, e de
    // passagem reafirma o verify_jwt de quem já estava aberto no servidor.
    const cmd = /supabase functions deploy([^\n]*)/.exec(comandos);
    expect(cmd).not.toBeNull();
    const nomes = fs
      .readdirSync(fileURLToPath(new URL('../supabase/functions/', import.meta.url)), {
        withFileTypes: true,
      })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const nome of nomes) expect(cmd[1]).not.toContain(nome);
  });

  it('mudança só no config.toml também dispara deploy', () => {
    // verify_jwt vive no servidor, não no repositório: trocar o valor e não
    // reimplantar deixa o repositório dizendo uma coisa e o servidor fazendo
    // outra — exatamente o furo que a Fase 0 encontrou.
    const paths = /paths:\n((?:\s+- .*\n)+)/.exec(comandos);
    expect(paths).not.toBeNull();
    expect(paths[1]).toContain('supabase/config.toml');
    expect(paths[1]).toContain('supabase/functions/**');
  });

  it('o ref do projeto que o workflow extrai existe no config.toml', () => {
    // O passo do deploy lê o project_id com sed; sem a linha, o deploy falha
    // no CI em vez de publicar no projeto errado.
    expect(configToml).toMatch(/^project_id = "[a-z0-9]+"/m);
  });

  it('o token de deploy vem de secret, nunca escrito no arquivo', () => {
    expect(workflow).toContain('secrets.SUPABASE_ACCESS_TOKEN');
    // `sbp_` é o prefixo do personal access token do Supabase.
    expect(workflow).not.toMatch(/sbp_[A-Za-z0-9]/);
  });
});
