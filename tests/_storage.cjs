// Junta as partes da camada de dados na ordem do index.html e compila como
// um único módulo — exatamente o código que era o storage.js antes da divisão.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const PARTS = ['storage.js', 'storage-anexos.js', 'storage-pendencias.js', 'storage-visitas.js', 'storage-operadores.js']
  .map((f) => path.join(__dirname, '..', 'js', f));

function storageSource() {
  return PARTS.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

/** Equivale ao antigo `delete require.cache[...]; require('../js/storage.js')`: sempre um módulo novo. */
function requireStorage() {
  const filename = PARTS[0];
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(storageSource(), filename);
  return m.exports;
}

module.exports = { storageSource, requireStorage, STORAGE_PARTS: PARTS };
