// tools/whatsapp-simular.js — manda para o webhook `whatsapp` uma mensagem no
// formato do WAHA (evento "message"), para testar a entrada sem celular nem
// sessão conectada.
//
//   WHATSAPP_WEBHOOK_TOKEN=... node tools/whatsapp-simular.js \
//     --url https://<ref>.supabase.co/functions/v1/whatsapp --texto "oi"
//
// Opções: --telefone, --nome, --texto, --id, --url, --token (sobrescreve o do
// env; `--token errado` serve para conferir o 401) e --mostrar (só imprime o
// payload, sem enviar).
//
// O token vem do env de propósito: em argumento ficaria no histórico do shell.
// E nunca é impresso — nem a URL, que o carrega na query.

const PADRAO = {
  telefone: '5511987654321',
  nome: 'Cliente de teste',
  texto: 'Olá, a impressora parou de novo.',
  url: '',
  token: '',
  id: '',
  mostrar: false,
};

function lerArgs(argv) {
  const out = { ...PADRAO };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mostrar') {
      out.mostrar = true;
      continue;
    }
    if (!a.startsWith('--')) continue;
    const nome = a.slice(2);
    if (!(nome in PADRAO) || nome === 'mostrar') continue;
    const valor = argv[i + 1];
    if (valor === undefined) continue;
    out[nome] = valor;
    i++;
  }
  return out;
}

// O id muda a cada execução porque o webhook deduplica por messageId: repetir
// o mesmo id faria a segunda simulação sumir sem explicação.
function montarPayload(opcoes, agora = Date.now()) {
  const telefone = String(opcoes.telefone || '').replace(/\D/g, '');
  return {
    event: 'message',
    session: 'default',
    payload: {
      id: opcoes.id || 'SIM' + agora.toString(36).toUpperCase(),
      timestamp: Math.floor(agora / 1000),
      from: telefone + '@c.us',
      fromMe: false,
      body: opcoes.texto || '',
      hasMedia: false,
      _data: { notifyName: opcoes.nome || '' },
    },
  };
}

function urlComToken(base, token) {
  const u = new URL(base);
  u.searchParams.set('token', token);
  return u.toString();
}

async function principal(argv = process.argv.slice(2), env = process.env) {
  const opcoes = lerArgs(argv);
  const payload = montarPayload(opcoes);
  if (opcoes.mostrar) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  const token = opcoes.token || env.WHATSAPP_WEBHOOK_TOKEN || '';
  if (!opcoes.url) {
    console.error('Falta --url (ex.: https://<ref>.supabase.co/functions/v1/whatsapp).');
    return 1;
  }
  if (!token) {
    console.error('Defina WHATSAPP_WEBHOOK_TOKEN no ambiente (ou --token).');
    return 1;
  }
  const resp = await fetch(urlComToken(opcoes.url, token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log('HTTP ' + resp.status);
  console.log(await resp.text());
  return resp.ok ? 0 : 1;
}

module.exports = { lerArgs, montarPayload, urlComToken, principal };

if (require.main === module) {
  principal()
    .then((code) => process.exit(code))
    .catch((err) => {
      // Só a mensagem: o erro do fetch pode trazer a URL, que tem o token.
      console.error('Falhou: ' + (err && err.code ? err.code : 'erro de rede'));
      process.exit(1);
    });
}
