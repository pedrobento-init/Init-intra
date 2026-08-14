const fs = require('fs');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

const content = `// Gerado automaticamente no build da Vercel
window.SUPABASE_CONFIG = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)}
};
`;

fs.writeFileSync('js/config.js', content);
console.log('✅ js/config.js gerado com sucesso a partir das Environment Variables da Vercel.');
