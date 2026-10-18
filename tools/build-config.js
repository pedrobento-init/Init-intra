// tools/build-config.js — gera js/config.js a partir das variáveis da Vercel.
// Só escreve no build da Vercel/CI (ou com as variáveis definidas): rodar o
// build na máquina de alguém nunca apaga o js/config.js local dessa pessoa.
const fs = require('fs');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const inCi = !!(process.env.VERCEL || process.env.CI);

if (!inCi && !url && !anonKey) {
  console.log('ℹ️ build-config: fora da Vercel/CI e sem SUPABASE_URL — js/config.js local mantido.');
  process.exit(0);
}

const content = `// Gerado automaticamente no build da Vercel
window.SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)}
};
`;

fs.writeFileSync('js/config.js', content);
console.log('✅ js/config.js gerado a partir das Environment Variables' + (url ? '' : ' (vazias)') + '.');
