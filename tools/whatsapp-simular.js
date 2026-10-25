// tools/whatsapp-simular.js — finge ser a Meta e chama a function `whatsapp`.
//
// Serve para testar a ponta inteira (assinatura → triagem → chamado) antes de
// existir app, número ou webhook na Meta. O payload tem o mesmo formato que a
// Meta manda, e tests/whatsapp-simular.test.js joga ele no parser de verdade
// (mensagensDoWebhook) — se um dia os dois divergirem, o teste quebra em vez
// de o simulador mentir que está tudo bem.
//
// USO:
//   export WHATSAPP_APP_SECRET=<App secret do app na Meta>
//   node tools/whatsapp-simular.js --url https://<ref>.supabase.co/functions/v1/whatsapp \
//     --de 5511999990000 --nome "Beatriz Rangel" --texto "O notebook não liga"
//
//   # só o handshake de cadastro (GET), com WHATSAPP_VERIFY_TOKEN no ambiente:
//   node tools/whatsapp-simular.js --url <url> --verificar
//
//   # imprime payload e assinatura sem mandar nada (para colar num curl):
//   node tools/whatsapp-simular.js --mostrar --texto "teste"
//
// O segredo vem do AMBIENTE, nunca de um argumento: argumento fica no
// histórico do shell e na lista de processos da máquina.

const { createHmac, randomUUID } = require('node:crypto');

const PADRAO = {
  de: '5511999990000',
  nome: 'Cliente de Teste',
  texto: 'Bom dia, o notebook não liga mais desde ontem.',
};

/** --chave valor → { chave: valor }; --flag sozinho vira true. */
function lerArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const chave = a.slice(2);
    const prox = argv[i + 1];
    if (prox === undefined || prox.startsWith('--')) out[chave] = true;
    else { out[chave] = prox; i++; }
  }
  return out;
}

/**
 * Envelope igual ao que a Meta manda no webhook `messages`.
 *
 * `id` é sorteado a cada chamada de propósito: a function guarda o id em
 * `avisos_enviados` para não abrir o mesmo chamado duas vezes, então um id
 * fixo faria a segunda rodada do teste não fazer nada — e parecer quebrada.
 */
function montarPayload(opts = {}) {
  const de = String(opts.de || PADRAO.de).replace(/\D/g, '');
  const nome = String(opts.nome || PADRAO.nome);
  const texto = String(opts.texto || PADRAO.texto);
  const id = String(opts.id || 'wamid.SIMULADO.' + randomUUID());
  // A Meta manda epoch em SEGUNDOS, como string.
  const timestamp = String(opts.timestamp || Math.floor(Date.now() / 1000));
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA-SIMULADA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '551140000000', phone_number_id: 'PHONE-SIMULADO' },
          contacts: [{ wa_id: de, profile: { name: nome } }],
          messages: [{ from: de, id, timestamp, type: 'text', text: { body: texto } }],
        },
      }],
    }],
  };
}

/** Mesmo HMAC que a Meta assina: sha256 do corpo CRU, em hex. */
function assinar(corpoCru, appSecret) {
  return 'sha256=' + createHmac('sha256', appSecret).update(corpoCru).digest('hex');
}

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  const url = typeof args.url === 'string' ? args.url.replace(/\/$/, '') : '';

  // Corpo e assinatura primeiro: --mostrar não precisa de URL nem de rede.
  const payload = montarPayload(args);
  const corpo = JSON.stringify(payload);
  const segredo = process.env.WHATSAPP_APP_SECRET || '';

  if (args.mostrar) {
    console.log(corpo);
    if (segredo) console.log('\nX-Hub-Signature-256: ' + assinar(corpo, segredo));
    else console.log('\n(sem WHATSAPP_APP_SECRET no ambiente: assinatura não gerada)');
    return;
  }

  if (!url) {
    console.error('Falta --url. Ex: --url https://<ref>.supabase.co/functions/v1/whatsapp');
    process.exitCode = 1;
    return;
  }

  // ── Handshake de cadastro (o que a Meta faz uma vez, ao salvar o webhook) ──
  if (args.verificar) {
    const token = process.env.WHATSAPP_VERIFY_TOKEN || '';
    if (!token) {
      console.error('Falta WHATSAPP_VERIFY_TOKEN no ambiente.');
      process.exitCode = 1;
      return;
    }
    const desafio = 'desafio-' + randomUUID().slice(0, 8);
    const q = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': token,
      'hub.challenge': desafio,
    });
    const r = await fetch(url + '?' + q.toString());
    const corpoResp = await r.text();
    const ok = r.status === 200 && corpoResp === desafio;
    console.log(`GET ${r.status} · devolveu ${JSON.stringify(corpoResp)}`);
    console.log(ok
      ? '✅ handshake OK — este é o verify token que vai no painel da Meta.'
      : '❌ handshake falhou. Confira se WHATSAPP_VERIFY_TOKEN é o mesmo secret da function.');
    if (!ok) process.exitCode = 1;
    return;
  }

  if (!segredo) {
    console.error('Falta WHATSAPP_APP_SECRET no ambiente (é com ele que o corpo é assinado).');
    process.exitCode = 1;
    return;
  }

  const assinatura = args.assinatura === 'errada'
    ? assinar(corpo, segredo + '-errado') // para conferir que a função recusa
    : assinar(corpo, segredo);

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinatura },
    body: corpo,
  });
  const texto = await r.text();
  console.log(`POST ${r.status}`);
  console.log(texto);

  if (r.status === 401) {
    console.log('\n401 = assinatura recusada. Com --assinatura errada, é o esperado.');
    console.log('Sem ele, confira se WHATSAPP_APP_SECRET aqui é o mesmo secret da function.');
  } else if (r.ok) {
    try {
      const d = JSON.parse(texto);
      if (d.abertas) console.log(`\n✅ ${d.abertas} chamado(s) aberto(s).`);
      else if (d.notas) console.log(`\n✅ ${d.notas} nota(s) em chamado que já estava aberto.`);
      else if ((d.sem_cliente || []).length) {
        console.log(`\n⚠️ Nenhum cliente com o telefone ${d.sem_cliente.join(', ')}.`);
        console.log('Ponha esse número em "Dono" ou "Responsável" na ficha de um cliente.');
      } else console.log('\n⚠️ Nada aconteceu. Mensagem repetida (mesmo id) costuma ser a causa.');
    } catch (_) { /* resposta não-JSON: o corpo cru acima já basta */ }
  }
}

if (require.main === module) {
  principal().catch((e) => {
    console.error('Falhou:', e && e.message ? e.message : e);
    process.exitCode = 1;
  });
}

module.exports = { montarPayload, assinar, lerArgs };
