import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// tools/migrar-supabase.ps1 mexe em dois bancos de produção. Não dá para
// executá-lo aqui (PowerShell, Docker e dois projetos reais), então o que se
// trava é o que ele NÃO pode fazer: escrever no projeto antigo, apagar coisa
// ou deixar dado real ir para o Git.

const script = fs.readFileSync('tools/migrar-supabase.ps1', 'utf8').replace(/\r\n/g, '\n');
// Só o código: as linhas de comentário (# ...) e o bloco de ajuda (<# ... #>)
// explicam o script e podem citar palavras como "apaga".
const codigo = script
  .replace(/<#[\s\S]*?#>/, '')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('tools/migrar-supabase.ps1', () => {
  it('o projeto antigo só é lido: nunca é destino de restore nem de escrita', () => {
    const comandosComAntigo = codigo.split('\n').filter((l) => l.includes('OLD_DB_URL'));
    expect(comandosComAntigo.length).toBeGreaterThan(0);
    for (const linha of comandosComAntigo) {
      expect(linha).not.toMatch(/pg_restore|alter |insert |update |delete |drop |truncate /i);
    }
  });

  it('todo pg_restore e toda escrita usam o projeto NOVO', () => {
    const restores = codigo.match(/pg_restore[^\n]*/g) || [];
    expect(restores.length).toBeGreaterThan(0);
    for (const r of restores.filter((x) => x.includes('--dbname'))) {
      expect(r).toContain('NEW_DB_URL');
      expect(r).not.toContain('OLD_DB_URL');
    }
  });

  it('não tem comando destrutivo (drop, truncate, delete, --clean)', () => {
    expect(codigo).not.toMatch(/\bdrop\s+(table|schema|database)\b/i);
    expect(codigo).not.toMatch(/\btruncate\b/i);
    expect(codigo).not.toMatch(/\bdelete\s+from\b/i);
    expect(codigo).not.toMatch(/--clean|\s-c\s+--/);
  });

  it('importar exige digitar MIGRAR e recusa projeto novo com tabelas', () => {
    expect(codigo).toMatch(/-ne 'MIGRAR'/);
    expect(codigo).toMatch(/\$tabelas -gt 0 -and -not \$Forcar/);
  });

  it('repetir a importação não duplica usuários nem buckets já copiados', () => {
    expect(codigo).toMatch(/select count\(\*\) from auth\.users/);
    expect(codigo).toMatch(/select count\(\*\) from storage\.buckets/);
    expect(codigo).toMatch(/\$usuarios -gt 0/);
    expect(codigo).toMatch(/\$buckets -gt 0/);
  });

  it('o padrão é só exportar (a etapa que não escreve em banco nenhum)', () => {
    expect(codigo).toMatch(/\[string\]\$Etapa = 'exportar'/);
  });

  it('a string de conexão entra no contêiner pelo NOME da variável, nunca pelo valor', () => {
    expect(codigo).toMatch(/@\('-e', \$v\)/);
    expect(codigo).not.toMatch(/postgres(ql)?:\/\/[^'"\s$]+:[^'"\s$@]+@/);
  });

  it('o nome da tabela do Realtime é validado antes de virar SQL', () => {
    expect(codigo).toMatch(/-notmatch '\^\[a-z_\]\[a-z0-9_\]\*\$'/);
  });
});

describe('dados da migração fora do Git', () => {
  const ignorado = fs.readFileSync('.gitignore', 'utf8').replace(/\r\n/g, '\n').split('\n');

  it('a pasta dos dumps e o arquivo de secrets estão no .gitignore', () => {
    expect(ignorado).toContain('migracao/');
    expect(ignorado).toContain('.env.migracao');
  });
});
