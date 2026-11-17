// tools/globais-de-topo.js — declarações de topo dos scripts de js/
// =====================================================================
// js/ roda em modo script (um único escopo global, sem import/export).
// Este módulo lê os <script src="js/..."> do index.html e extrai, com o
// parser do acorn, tudo que cada arquivo declara no topo. Quem usa:
//   - eslint.config.mjs  → lista de globais para o `no-undef`;
//   - tests/globais-colisao.test.js → falha se dois arquivos declaram o mesmo nome.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
// config.js é gerado no deploy e fica fora do git: pode não existir no checkout.
const GERADOS = new Set(['js/config.js']);

function scriptsDoIndex() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const out = [];
  const re = /<script[^>]*\bsrc="(js\/[^"]+\.js)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) if (!GERADOS.has(m[1])) out.push(m[1]);
  return out;
}

function nomesDoPadrao(p, acc) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': acc.push(p.name); break;
    case 'ObjectPattern': p.properties.forEach((x) => nomesDoPadrao(x.value || x.argument, acc)); break;
    case 'ArrayPattern': p.elements.forEach((x) => nomesDoPadrao(x, acc)); break;
    case 'AssignmentPattern': nomesDoPadrao(p.left, acc); break;
    case 'RestElement': nomesDoPadrao(p.argument, acc); break;
  }
}

// `var` dentro de blocos/if/for de topo também vaza para o escopo global.
function coletarVarEmBlocos(node, acc) {
  if (!node || typeof node.type !== 'string') return;
  if (/Function|Class/.test(node.type)) return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    node.declarations.forEach((d) => nomesDoPadrao(d.id, acc));
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => coletarVarEmBlocos(c, acc));
    else if (v && typeof v === 'object') coletarVarEmBlocos(v, acc);
  }
}

function declaracoesDeTopo(src, arquivo) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true });
  const out = [];
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
      out.push({ nome: n.id.name, tipo: n.type === 'ClassDeclaration' ? 'class' : 'function', arquivo, corpo: src.slice(n.start, n.end) });
    } else if (n.type === 'VariableDeclaration') {
      const nomes = [];
      n.declarations.forEach((d) => nomesDoPadrao(d.id, nomes));
      out.push(...nomes.map((nome) => ({ nome, tipo: n.kind, arquivo })));
    } else {
      const v = [];
      coletarVarEmBlocos(n, v);
      out.push(...v.map((nome) => ({ nome, tipo: 'var', arquivo })));
    }
  }
  return out;
}

// Todas as declarações de topo dos scripts carregados, na ordem do index.html.
function coletarDeclaracoes() {
  const arquivos = scriptsDoIndex();
  const todas = [];
  for (const rel of arquivos) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    todas.push(...declaracoesDeTopo(src, rel));
  }
  return { arquivos, declaracoes: todas };
}

module.exports = { ROOT, scriptsDoIndex, declaracoesDeTopo, coletarDeclaracoes };
