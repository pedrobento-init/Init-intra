// Junta as partes de um módulo dividido na ordem do index.html e compila
// como um único módulo — exatamente o código de antes da divisão.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const GROUPS = {
  storage: ['storage.js', 'storage-anexos.js', 'storage-pendencias.js', 'storage-visitas.js', 'storage-operadores.js'],
  clients: ['clients.js', 'clients-ficha.js', 'clients-abas.js', 'clients-form.js'],
  pendencias: ['pendencias.js', 'pendencias-quadro.js', 'pendencias-acoes.js', 'pendencias-detalhe.js', 'pendencias-comando.js'],
};
const filesOf = (g) => GROUPS[g].map((f) => path.join(__dirname, '..', 'js', f));

/** Código-fonte do grupo, concatenado. */
function partsSource(group) {
  return filesOf(group).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

/** Equivale ao antigo `delete require.cache[...]; require('../js/<grupo>.js')`: sempre um módulo novo. */
function requireParts(group) {
  const filename = filesOf(group)[0];
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(partsSource(group), filename);
  return m.exports;
}

module.exports = {
  partsSource, requireParts, GROUPS,
  // compatibilidade com os testes que já usavam o loader do storage
  storageSource: () => partsSource('storage'),
  requireStorage: () => requireParts('storage'),
};
