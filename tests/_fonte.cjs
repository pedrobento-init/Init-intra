// Leitura de código-fonte para testes de contrato. O prettier reformata o
// repositório (quebra de linha, indentação, aspas, vírgula final), então a
// asserção casa sobre o texto NORMALIZADO — e o trecho esperado passa pela
// mesma normalização. O invariante continua sendo o conteúdo, não a formatação.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

/** Normaliza: CRLF -> LF, aspas simples/duplas -> ", sem vírgula final e sem espaço em volta de pontuação. */
function norm(texto) {
  return String(texto)
    .replace(/\r\n?/g, '\n')
    .replace(/'/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/,\s*([)\]}])/g, '$1')
    .replace(/\s*([()[\]{},;:?])\s*/g, '$1')
    .trim();
}

/** Lê um arquivo do repositório (caminho relativo à raiz), já normalizado. */
function fonte(rel) {
  return norm(fs.readFileSync(path.join(RAIZ, rel), 'utf8'));
}

/** Lê sem normalizar (para quem precisa de linhas), mas com CRLF -> LF. */
function fonteBruta(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n?/g, '\n');
}

/** Regex tolerante: aplica norm() ao texto de uma regex escrita como string. Uso: rx('a(b)') não escapa nada. */
module.exports = { norm, fonte, fonteBruta, RAIZ };
