import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { ROOT, coletarDeclaracoes } = require('../tools/globais-de-topo.js');

// Allowlist explícita: nome -> justificativa. Só entra aqui colisão que NÃO
// dá para renomear com segurança. Para as do tipo "espelho" o teste ainda
// exige corpo idêntico entre as cópias (divergência silenciosa = falha).
const ESPELHO_PURO =
  'espelho de helper puro: metrics.js é testado isolado via require() e por isso ' +
  'repete a função; o corpo é idêntico e o último script carregado (metrics.js) vence';
const PERMITIDAS = {
  isPendenciaResolvida: { motivo: ESPELHO_PURO, espelho: true },
  getPendenciaAssunto: { motivo: ESPELHO_PURO, espelho: true },
  getPendenciaTitulo: { motivo: ESPELHO_PURO, espelho: true },
  getNoteSnippet: { motivo: ESPELHO_PURO, espelho: true },
  parseSearchShortcuts: { motivo: ESPELHO_PURO, espelho: true },
  parseMentionedOperators: {
    motivo:
      'pendencias.js só define `var` sob `if (typeof X !== "function")` (fallback); ' +
      'storage-pendencias.js carrega antes e a função real prevalece',
  },
  highlightMentions: {
    motivo: 'idem parseMentionedOperators: fallback guardado por typeof em pendencias.js',
  },
};
// Os helpers de escape do snippet têm nomes diferentes nas duas cópias.
const normalizaEspelho = (t) =>
  t.replace(/_escapeForSnippet|_snippetEscapeHtml/g, 'ESC').replace(/\s+/g, ' ');

describe('colisão de globais entre scripts de js/', () => {
  const { arquivos, declaracoes } = coletarDeclaracoes();
  const porNome = new Map();
  for (const d of declaracoes) {
    if (!porNome.has(d.nome)) porNome.set(d.nome, []);
    porNome.get(d.nome).push(d);
  }

  it('o index.html carrega scripts e todos existem', () => {
    expect(arquivos.length).toBeGreaterThan(50);
    for (const rel of arquivos) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });

  it('nenhum nome de topo é declarado em dois arquivos diferentes', () => {
    const colisoes = [];
    for (const [nome, ds] of porNome) {
      const arqs = [...new Set(ds.map((d) => d.arquivo))];
      if (arqs.length > 1 && !(nome in PERMITIDAS)) {
        colisoes.push(`${nome}: ${ds.map((d) => `${d.tipo}@${d.arquivo}`).join(', ')}`);
      }
    }
    expect(colisoes, 'globais duplicados:\n' + colisoes.join('\n')).toEqual([]);
  });

  it('let/const/class não se repetem dentro do mesmo arquivo', () => {
    const dup = [];
    for (const [nome, ds] of porNome) {
      const porArq = new Map();
      for (const d of ds) porArq.set(d.arquivo, [...(porArq.get(d.arquivo) || []), d.tipo]);
      for (const tipos of porArq.values()) {
        if (tipos.length > 1 && tipos.some((t) => t === 'let' || t === 'const' || t === 'class'))
          dup.push(nome);
      }
    }
    expect(dup).toEqual([]);
  });

  it('cópias "espelho" da allowlist têm corpo idêntico', () => {
    for (const [nome, info] of Object.entries(PERMITIDAS)) {
      if (!info.espelho) continue;
      const corpos = new Set(
        porNome
          .get(nome)
          .filter((d) => d.tipo === 'function')
          .map((d) => normalizaEspelho(d.corpo))
      );
      expect(corpos.size, `${nome} divergiu entre as cópias`).toBe(1);
    }
  });

  it('entradas da allowlist ainda colidem de fato (sem justificativa velha)', () => {
    for (const nome of Object.keys(PERMITIDAS)) {
      const arqs = new Set((porNome.get(nome) || []).map((d) => d.arquivo));
      expect(arqs.size, `${nome} não colide mais: remova da allowlist`).toBeGreaterThan(1);
    }
  });
});
