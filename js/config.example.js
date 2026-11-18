// js/config.example.js
// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE — Copie este arquivo para js/config.js e preencha com os valores
// reais do seu projeto Supabase. O arquivo js/config.js está no .gitignore
// e NÃO deve ser comitado.
//
// Como obter os valores:
//   1. Acesse https://supabase.com/dashboard → seu projeto → Settings → API Keys
//   2. Copie "Project URL" e a chave pública, com o botão de copiar:
//        - projeto novo: a "publishable" (sb_publishable_...);
//        - projeto antigo: a "anon" legada (eyJ...).
//      NUNCA a "secret" (sb_secret_...) nem a "service_role": elas dão acesso
//      total ao banco e não podem ir para o navegador.
//   3. Troque o texto entre as aspas INTEIRO. Não deixe sobra do exemplo: uma
//      chave eyJ... com um pedaço a mais na frente é recusada (401 Invalid API key).
// ─────────────────────────────────────────────────────────────────────────────

window.SUPABASE_CONFIG = {
  url: 'https://SEU-PROJECT-REF.supabase.co',
  anonKey: 'COLE_AQUI_A_CHAVE_PUBLICA',
};
