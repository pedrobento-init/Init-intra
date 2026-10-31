// chamado-canal.js — Por onde o chamado conversa com quem pediu (075).
// =============================================================================
// O chamado nasceu do e-mail e ganhou o WhatsApp. A nota que vai para o
// solicitante precisa sair pelo mesmo canal por onde ele falou: responder por
// e-mail a quem mandou WhatsApp é deixar a pessoa sem resposta. Este arquivo é
// o despachante — quem escreve a nota não precisa saber qual Edge Function
// chamar, só passa o chamado e o texto.
//
// O telefone NÃO tem coluna própria na pendência: mora em emailThreadId, como
// 'whatsapp:<dígitos>'. É o mesmo campo que amarra a conversa do e-mail, e o
// whatsapp-responder lê dali para quem mandar.

const CHAMADO_CANAL_ROTULOS = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
};

function _chamadoCampo(p, camel, snake) {
  if (!p) return '';
  return p[camel] != null ? p[camel] : (p[snake] != null ? p[snake] : '');
}

// O thread 'whatsapp:' vence o e-mail: a pendência do WhatsApp pode ter
// solicitanteEmail herdado do cadastro, mas a pessoa falou pelo telefone e
// espera a resposta lá. A coluna canal sozinha não basta: o whatsapp-responder
// tira o destino do thread, e sem ele o composer ofereceria um envio que falha.
function chamadoCanalDe(p) {
  if (!p) return null;
  const thread = String(_chamadoCampo(p, 'emailThreadId', 'email_thread_id') || '');
  if (thread.indexOf('whatsapp:') === 0) return 'whatsapp';
  if (String(_chamadoCampo(p, 'solicitanteEmail', 'solicitante_email') || '').trim()) return 'email';
  return null;
}

function chamadoCanalRotulo(canal) {
  return CHAMADO_CANAL_ROTULOS[canal] || 'Sem canal';
}

function chamadoTelefoneDigitos(t) {
  return String(t || '').replace(/\D/g, '');
}

// Chave para comparar telefones escritos de jeitos diferentes: o cadastro tem
// "(11) 98765-4321", o WhatsApp manda "5511987654321", e número antigo ainda
// aparece sem o nono dígito. Tira o 55 e o nono dígito para que os três batam.
function chamadoTelefoneChave(t) {
  let d = chamadoTelefoneDigitos(t);
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d.length >= 10 ? d : '';
}

function chamadoTelefoneFormatar(t) {
  let d = chamadoTelefoneDigitos(t);
  if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return String(t || '').trim();
}

// Telefone do chamado de WhatsApp, lido do thread id. Vazio para os outros.
function chamadoTelefoneDe(p) {
  const thread = String(_chamadoCampo(p, 'emailThreadId', 'email_thread_id') || '');
  return thread.indexOf('whatsapp:') === 0 ? thread.slice('whatsapp:'.length) : '';
}

function _chamadoOnline() {
  return typeof isSupabaseConnected === 'function' && isSupabaseConnected() && !!window._supabaseAuthActive;
}

// Os textos do e-mail são os mesmos do penResponderPorEmail: quem lê o toast
// não deve perceber que o envio mudou de lugar.
function _chamadoEnviarEmail(p, texto) {
  if (!_chamadoOnline()) {
    showToast('A nota foi salva, mas o e-mail não saiu: sem conexão com o servidor.', 'error');
    return Promise.resolve();
  }
  return supabaseClient.functions.invoke('pendencia-responder', { body: { pendencia_id: p.id, text: texto } })
    .then(function (r) {
      const d = r && r.data;
      if ((r && r.error) || !d || d.success !== true) {
        const msg = (d && d.error) || (r && r.error && r.error.message) || 'erro desconhecido';
        showToast('A nota foi salva, mas o e-mail não saiu: ' + msg, 'error');
        return;
      }
      showToast(d.threaded ? 'E-mail enviado para ' + d.to + '.'
        : 'E-mail enviado para ' + d.to + ' — como conversa nova (o original não trouxe Message-ID).', 'success');
    })
    .catch(function (e) {
      showToast('A nota foi salva, mas o e-mail não saiu.', 'error');
      if (typeof _logSilent === 'function') _logSilent(e, 'chamado-canal:responder-email');
    });
}

function _chamadoEnviarWhatsapp(p, texto) {
  if (!_chamadoOnline()) {
    showToast('A nota foi salva, mas a mensagem não saiu: sem conexão com o servidor.', 'error');
    return Promise.resolve();
  }
  return supabaseClient.functions.invoke('whatsapp-responder', { body: { pendencia_id: p.id, text: texto } })
    .then(function (r) {
      const d = r && r.data;
      if ((r && r.error) || !d || d.success !== true) {
        const msg = (d && d.error) || (r && r.error && r.error.message) || 'erro desconhecido';
        showToast('A nota foi salva, mas a mensagem não saiu: ' + msg, 'error');
        return;
      }
      showToast('Mensagem enviada no WhatsApp para ' + chamadoTelefoneFormatar(d.to) + '.', 'success');
    })
    .catch(function (e) {
      showToast('A nota foi salva, mas a mensagem não saiu.', 'error');
      if (typeof _logSilent === 'function') _logSilent(e, 'chamado-canal:responder-whatsapp');
    });
}

// Sempre devolve Promise, mesmo sem canal: quem chama pode encadear sem
// testar o retorno. Sem canal não é erro — a nota fica só no chamado.
function chamadoEnviarResposta(p, texto) {
  const canal = chamadoCanalDe(p);
  if (canal === 'whatsapp') return _chamadoEnviarWhatsapp(p, texto);
  if (canal === 'email') return _chamadoEnviarEmail(p, texto);
  return Promise.resolve();
}
