// Init Intra — robô da Agenda Google (Google Apps Script).
//
// Roda de minuto em minuto na conta do robô (ex.: agenda@empresa). Cada
// técnico compartilha a própria agenda com essa conta ("Fazer alterações nos
// eventos"). A cada execução:
//   1. pergunta ao Intra (Edge Function google-agenda) o que enviar;
//   2. lê o que mudou em cada agenda desde a última vez (syncToken);
//   3. cria/altera/apaga os eventos das visitas;
//   4. devolve ao Intra o resultado e as mudanças feitas no Google.
// Os syncTokens só avançam depois que o Intra confirma: se a rede falhar no
// meio, a próxima execução lê de novo as mesmas mudanças.
//
// INSTALAÇÃO (passo a passo em GOOGLE-AGENDA.md):
//   - Serviços → adicionar "Google Calendar API" (identificador: Calendar).
//   - Configurações do projeto → Propriedades do script:
//       SYNC_URL    = https://<ref-do-projeto>.supabase.co/functions/v1/google-agenda
//       SYNC_SECRET = o mesmo AGENDA_SYNC_SECRET da Edge Function
//   - Rodar instalar() uma vez e autorizar.

var TOKEN_PREFIX = 'sync:';

function instalar() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SYNC_URL') || !p.getProperty('SYNC_SECRET')) {
    throw new Error('Preencha SYNC_URL e SYNC_SECRET em Configurações do projeto → Propriedades do script.');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(1).create();
  sincronizar();
  Logger.log('Instalado: sincronizando a cada minuto como ' + Session.getEffectiveUser().getEmail());
}

/** Esquece as posições de leitura (a próxima execução relê as agendas inteiras). */
function reiniciarLeitura() {
  var p = PropertiesService.getScriptProperties();
  Object.keys(p.getProperties()).forEach(function (k) { if (k.indexOf(TOKEN_PREFIX) === 0) p.deleteProperty(k); });
}

function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;  // execução anterior ainda rodando
  try {
    var props = PropertiesService.getScriptProperties();
    var plan = chamar_('begin', { runner_email: Session.getEffectiveUser().getEmail() });

    var calendars = [], changes = [], tokens = {}, semAcesso = {};
    plan.calendars.forEach(function (c) {
      try {
        var r = lerMudancas_(c.cal, props.getProperty(TOKEN_PREFIX + c.cal));
        r.events.forEach(function (ev) { changes.push({ op: c.op, event: ev }); });
        if (r.nextSyncToken) tokens[TOKEN_PREFIX + c.cal] = r.nextSyncToken;
        calendars.push({ op: c.op, ok: true });
      } catch (e) {
        var access = codigo_(e) === 403 || codigo_(e) === 404;
        semAcesso[c.cal] = access ? 'access' : 'temp';
        calendars.push({ op: c.op, ok: false, access: access, error: acessoMsg_(e) });
      }
    });

    var pushed = plan.push.map(function (item) { return enviar_(item, semAcesso); });

    chamar_('finish', { calendars: calendars, changes: changes, pushed: pushed });
    props.setProperties(tokens);
  } finally {
    lock.releaseLock();
  }
}

/** SYNC_URL aceita só a raiz do projeto (https://<ref>.supabase.co): completa o caminho. */
function syncUrl_(raw) {
  var u = String(raw || '').trim().replace(/\/+$/, '');
  return /\/functions\/v1\//.test(u) ? u : u + '/functions/v1/google-agenda';
}

function chamar_(action, body) {
  var p = PropertiesService.getScriptProperties();
  body.action = action;
  var res = UrlFetchApp.fetch(syncUrl_(p.getProperty('SYNC_URL')), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-agenda-secret': String(p.getProperty('SYNC_SECRET') || '').trim() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Intra respondeu ' + res.getResponseCode() + ' em ' + action + ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

/** Eventos mudados desde o token (só os das visitas: id começa com "ii"). */
function lerMudancas_(calId, syncToken) {
  var events = [], pageToken = null, next = null;
  for (;;) {
    var args = { showDeleted: true, maxResults: 2500 };
    if (syncToken) args.syncToken = syncToken;
    if (pageToken) args.pageToken = pageToken;
    var page;
    try {
      page = Calendar.Events.list(calId, args);
    } catch (e) {
      // Token vencido (410): o Google pede leitura completa.
      if (syncToken && codigo_(e) === 410) return lerMudancas_(calId, null);
      throw e;
    }
    // No Workspace todos do domínio costumam VER a agenda dos outros; para
    // gravar precisa do compartilhamento "Fazer alterações nos eventos".
    if (page.accessRole && page.accessRole !== 'owner' && page.accessRole !== 'writer') {
      throw { details: { code: 403 }, message: 'Acesso só de leitura (' + page.accessRole + ')' };
    }
    (page.items || []).forEach(function (ev) {
      if (/^ii[0-9a-f]+$/.test(ev.id || '')) events.push({ id: ev.id, status: ev.status, start: ev.start, end: ev.end });
    });
    pageToken = page.nextPageToken;
    next = page.nextSyncToken || next;
    if (!pageToken) break;
  }
  return { events: events, nextSyncToken: next };
}

function enviar_(item, semAcesso) {
  var out = { seq: item.seq, visit_id: item.visit_id, hash: item.hash };
  // Sem acesso: sai da fila (volta toda quando o técnico compartilhar).
  // Falha passageira: tenta de novo na próxima execução.
  if (item.cal && semAcesso[item.cal] === 'access') { out.ok = false; out.access = true; return out; }
  if (item.cal && semAcesso[item.cal] === 'temp') { out.ok = false; out.error = 'Agenda indisponível agora'; return out; }
  try {
    (item.remove_from || []).forEach(function (cal) { if (semAcesso[cal] !== 'access') apagar_(cal, item.event_id); });
    if (item.cal && item.event) gravar_(item.cal, item.event);
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.message || e).slice(0, 300);
  }
  return out;
}

function gravar_(cal, ev) {
  var q = { sendUpdates: 'none' };
  try {
    Calendar.Events.patch(ev, cal, ev.id, q);
  } catch (e) {
    var c = codigo_(e);
    if (c !== 404 && c !== 410) throw e;
    try {
      Calendar.Events.insert(ev, cal, q);
    } catch (e2) {
      // Já existiu e foi apagado: o id continua reservado, então restaura.
      if (codigo_(e2) !== 409) throw e2;
      Calendar.Events.update(ev, cal, ev.id, q);
    }
  }
}

function apagar_(cal, eventId) {
  try {
    Calendar.Events.remove(cal, eventId, { sendUpdates: 'none' });
  } catch (e) {
    var c = codigo_(e);
    if (c !== 404 && c !== 410) throw e;
  }
}

/** Código HTTP do erro do serviço avançado (details.code ou o texto). */
function codigo_(e) {
  if (e && e.details && e.details.code) return Number(e.details.code);
  var m = String(e && e.message || e);
  if (/not found/i.test(m)) return 404;
  if (/deleted|no longer valid|gone/i.test(m)) return 410;
  if (/already exists|duplicate/i.test(m)) return 409;
  var n = /\b(4\d\d|5\d\d)\b/.exec(m);
  return n ? Number(n[1]) : 0;
}

function acessoMsg_(e) {
  var c = codigo_(e);
  if (c === 404 || c === 403) {
    return 'Agenda não compartilhada com ' + Session.getEffectiveUser().getEmail() + ' com a permissão "Fazer alterações nos eventos".';
  }
  return String(e && e.message || e).slice(0, 300);
}
