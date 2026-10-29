// Init Intra — tarefas do robô além da agenda das visitas (Google Apps Script).
// Arquivo à parte ("Robo.gs") no mesmo projeto do Código.gs, com as mesmas
// propriedades SYNC_URL / SYNC_SECRET. Não depende de nada do Código.gs.
// A regra fica na Edge Function "robo"; aqui só se fala com o Google.
//
//   roboVencimentos  de hora em hora   agenda "Vencimentos Init" (só leitura p/ a equipe)
//   roboResumo       por volta das 8h  e-mail "Seu dia" (o servidor envia) + Google Chat opcional
//   roboNoite        de madrugada      domínios (RDAP), planilha de indicadores, backup no Drive, pastas dos clientes
//   roboBackupsEmail de 30 em 30 min   e-mails do rótulo "Backups" do Gmail → status dos backups dos clientes
//   roboPendenciasEmail de 5 em 5 min   e-mails do rótulo "Pendências" do Gmail → pendência já preenchida
//
// INSTALAÇÃO: cole este arquivo como "Robo.gs" e rode instalarRobo() uma vez.
// Opcional: propriedade CHAT_WEBHOOK com o webhook de um espaço do Google Chat.
// Os IDs da agenda, planilha e pasta ficam nas propriedades VENC_CAL_ID,
// IND_SHEET_ID e BACKUP_FOLDER_ID (criados sozinhos na 1ª vez).

var ROBO_TAREFAS = ['roboVencimentos', 'roboResumo', 'roboNoite', 'roboBackupsEmail', 'roboPendenciasEmail'];
var ROTULO_BACKUPS = 'Backups';
var ROTULO_PENDENCIAS = 'Pendências';
var BACKUP_DIAS = 30;

function instalarRobo() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ROBO_TAREFAS.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('roboVencimentos').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('roboResumo').timeBased().everyDays(1).atHour(7).nearMinute(45).create();
  ScriptApp.newTrigger('roboNoite').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('roboBackupsEmail').timeBased().everyMinutes(30).create();
  // 5 min: o cliente espera resposta de chamado, não de backup. A rodada sem
  // e-mail novo sai antes de chamar a Edge Function, então o custo é a busca.
  ScriptApp.newTrigger('roboPendenciasEmail').timeBased().everyMinutes(5).create();
  roboVencimentos();
  roboNoite();
  roboBackupsEmail();
  roboPendenciasEmail();
  var p = PropertiesService.getScriptProperties();
  Logger.log('Agenda: https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(p.getProperty('VENC_CAL_ID')));
  Logger.log('Planilha: https://docs.google.com/spreadsheets/d/' + p.getProperty('IND_SHEET_ID'));
  Logger.log('Backups: https://drive.google.com/drive/folders/' + p.getProperty('BACKUP_FOLDER_ID'));
}

/** Teste do resumo sem mandar e-mail: mostra no log o texto que iria para o Chat. */
function testarResumo() {
  Logger.log(roboChamar_('resumo', { enviar: false }).chat);
}

/** Mostra no log o que roboPastas faria, sem escrever nada no Drive nem no banco. */
function testarPastas() {
  var r = roboChamar_('pastas');
  var buscar = r.buscar || [];
  var rootId = String(PropertiesService.getScriptProperties().getProperty('CLIENTES_ROOT_ID') || '').trim();
  var renomear = [], mover = [];
  r.vigiar.forEach(function (v) {
    if (!v.nome || v.compartilhada) return;
    try {
      var f = DriveApp.getFolderById(v.folder_id);
      if (f.isTrashed()) return;
      if (f.getName() !== v.nome) renomear.push(f.getName() + ' → ' + v.nome);
      if (rootId && !temPai_(f, rootId)) mover.push(v.nome);
    } catch (e) { /* inacessível: roboPastas marca */ }
  });
  Logger.log('Sem pasta, com planilha: ' + r.candidatos.length + ' | pastas a vigiar: ' + r.vigiar.length +
    ' | a buscar: ' + buscar.length + ' | a renomear: ' + renomear.length + ' | a mover: ' + mover.length);
  if (buscar.length) Logger.log('Buscar: ' + buscar.slice(0, 50).map(function (c) { return c.nome; }).join('; '));
  if (renomear.length) Logger.log('Renomear: ' + renomear.slice(0, 50).join('; '));
  if (mover.length) Logger.log('Mover: ' + mover.slice(0, 50).join('; '));
}

function roboChamar_(action, body) {
  var p = PropertiesService.getScriptProperties();
  body = body || {};
  body.action = action;
  var segredo = String(p.getProperty('SYNC_SECRET') || '').trim();
  if (!segredo) throw new Error('Preencha SYNC_SECRET nas Propriedades do script DESTE projeto (as propriedades não passam de um projeto para outro).');
  var res = UrlFetchApp.fetch(roboUrl_(p.getProperty('SYNC_URL')), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-agenda-secret': segredo },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 401) {
    throw new Error('SYNC_SECRET deste projeto não confere com o AGENDA_SYNC_SECRET do Supabase. Use o mesmo valor do projeto que sincroniza as visitas.');
  }
  if (res.getResponseCode() !== 200) {
    throw new Error('Intra respondeu ' + res.getResponseCode() + ' em ' + action + ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

/** SYNC_URL (raiz do projeto ou .../functions/v1/google-agenda) → .../functions/v1/robo. */
function roboUrl_(raw) {
  var u = String(raw || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('Preencha SYNC_URL em Configurações do projeto → Propriedades do script.');
  var m = /^(.*?)\/functions\/v1(\/.*)?$/.exec(u);
  return (m ? m[1] : u) + '/functions/v1/robo';
}

function roboCodigo_(e) {
  if (e && e.details && e.details.code) return Number(e.details.code);
  var m = String(e && e.message || e);
  if (/not found/i.test(m)) return 404;
  if (/deleted|gone/i.test(m)) return 410;
  if (/already exists|duplicate/i.test(m)) return 409;
  var n = /\b(4\d\d|5\d\d)\b/.exec(m);
  return n ? Number(n[1]) : 0;
}

function roboGravar_(cal, ev) {
  var q = { sendUpdates: 'none' };
  try {
    Calendar.Events.patch(ev, cal, ev.id, q);
  } catch (e) {
    var c = roboCodigo_(e);
    if (c !== 404 && c !== 410) throw e;
    try {
      Calendar.Events.insert(ev, cal, q);
    } catch (e2) {
      if (roboCodigo_(e2) !== 409) throw e2;  // já existiu e foi apagado: restaura
      Calendar.Events.update(ev, cal, ev.id, q);
    }
  }
}

function roboApagar_(cal, eventId) {
  try {
    Calendar.Events.remove(cal, eventId, { sendUpdates: 'none' });
  } catch (e) {
    var c = roboCodigo_(e);
    if (c !== 404 && c !== 410) throw e;
  }
}

// ── Agenda de vencimentos ───────────────────────────────────────────────────

function roboVencimentos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var plan = roboChamar_('vencimentos');
    var calId = agendaVencimentos_(plan.calendario);
    compartilhar_(calId, plan.leitores);

    var atuais = {};
    var pageToken = null;
    do {
      var page = Calendar.Events.list(calId, { maxResults: 2500, pageToken: pageToken, showDeleted: false });
      (page.items || []).forEach(function (ev) { if (/^vc[0-9a-f]+$/.test(ev.id)) atuais[ev.id] = ev; });
      pageToken = page.nextPageToken;
    } while (pageToken);

    plan.eventos.forEach(function (ev) {
      var cur = atuais[ev.id];
      delete atuais[ev.id];
      var h = ev.extendedProperties.private.h;
      if (cur && cur.extendedProperties && cur.extendedProperties.private && cur.extendedProperties.private.h === h) return;
      roboGravar_(calId, ev);
    });
    // Vencimento encerrado ou excluído no site: sai da agenda.
    Object.keys(atuais).forEach(function (id) { roboApagar_(calId, id); });
  } finally {
    lock.releaseLock();
  }
}

function agendaVencimentos_(nome) {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('VENC_CAL_ID');
  if (id) {
    try { Calendar.Calendars.get(id); return id; } catch (e) { /* apagada: cria de novo */ }
  }
  id = Calendar.Calendars.insert({ summary: nome, timeZone: 'America/Sao_Paulo',
    description: 'Licenças, SSL, domínios e garantias do Init Intra. Atualizada pelo robô; edite pelo site.' }).id;
  p.setProperty('VENC_CAL_ID', id);
  return id;
}

/** Equipe ativa vê a agenda (só leitura); quem saiu perde o acesso. */
function compartilhar_(calId, leitores) {
  var quer = {};
  leitores.forEach(function (e) { quer[e] = true; });
  var eu = Session.getEffectiveUser().getEmail().toLowerCase();
  (Calendar.Acl.list(calId).items || []).forEach(function (a) {
    if (!a.scope || a.scope.type !== 'user') return;
    var email = String(a.scope.value || '').toLowerCase();
    if (quer[email]) { delete quer[email]; return; }
    if (a.role === 'reader' && email !== eu) Calendar.Acl.remove(calId, a.id);
  });
  Object.keys(quer).forEach(function (email) {
    if (email === eu) return;
    try {
      Calendar.Acl.insert({ role: 'reader', scope: { type: 'user', value: email } }, calId, { sendNotifications: false });
    } catch (e) {
      Logger.log('Não compartilhou com ' + email + ': ' + e.message);  // ex.: domínio externo bloqueado
    }
  });
}

// ── Resumo diário ───────────────────────────────────────────────────────────

function roboResumo() {
  var r = roboChamar_('resumo', { enviar: true });
  Logger.log('Resumos enviados: ' + r.enviados + (r.falhas ? ' (falhas: ' + r.falhas + ')' : ''));
  var hook = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK');
  if (hook && r.chat) {
    UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify({ text: r.chat }) });
  }
}

// ── Backups dos clientes (e-mails no rótulo "Backups") ─────────────────────

/** Manda ao Intra os e-mails novos do rótulo; o Intra acha o cliente, grava o status e abre pendência se falhar. */
function roboBackupsEmail() {
  var p = PropertiesService.getScriptProperties();
  if (!GmailApp.getUserLabelByName(ROTULO_BACKUPS)) GmailApp.createLabel(ROTULO_BACKUPS);
  var desde = Number(p.getProperty('BACKUP_EMAIL_DESDE')) || (Date.now() - 3 * 86400000);
  var mensagens = [], maisNovo = desde;
  GmailApp.search('label:' + ROTULO_BACKUPS + ' after:' + Math.floor(desde / 1000), 0, 100).forEach(function (th) {
    th.getMessages().forEach(function (m) {
      var t = m.getDate().getTime();
      if (t <= desde) return;
      if (t > maisNovo) maisNovo = t;
      mensagens.push({ id: m.getId(), de: m.getFrom(), assunto: m.getSubject() || '', data: m.getDate().toISOString(),
        trecho: (m.getPlainBody() || '').slice(0, 2000) });
    });
  });
  // Mesmo sem e-mail novo chama: é aqui que o silêncio além do limite vira pendência.
  var r = roboChamar_('backups', { mensagens: mensagens });
  p.setProperty('BACKUP_EMAIL_DESDE', String(maisNovo));
  if (mensagens.length || r.alertas) Logger.log('Backups: ' + mensagens.length + ' e-mail(s), ' + r.casadas + ' de clientes, ' + r.alertas + ' pendência(s) aberta(s)');
}

// ── Triagem: e-mails do rótulo "Pendências" ────────────────────────────────

/**
 * Manda ao Intra os e-mails novos do rótulo; o Intra acha o cliente, pede a
 * classificação ao Make e abre a pendência. Marque o e-mail do cliente com o
 * rótulo (na mão ou por filtro do Gmail) e ele entra na próxima rodada.
 */
function roboPendenciasEmail() {
  var p = PropertiesService.getScriptProperties();
  if (!GmailApp.getUserLabelByName(ROTULO_PENDENCIAS)) GmailApp.createLabel(ROTULO_PENDENCIAS);
  var desde = Number(p.getProperty('TRIAGEM_EMAIL_DESDE')) || (Date.now() - 86400000);
  var mensagens = [], maisNovo = desde;
  GmailApp.search('label:"' + ROTULO_PENDENCIAS + '" after:' + Math.floor(desde / 1000), 0, 50).forEach(function (th) {
    th.getMessages().forEach(function (m) {
      var t = m.getDate().getTime();
      if (t <= desde) return;
      if (t > maisNovo) maisNovo = t;
      // message_id é o cabeçalho RFC 5322, não o id interno do Gmail: a
      // resposta do Intra devolve ele em In-Reply-To e fica na mesma conversa.
      // thread_id é a CONVERSA: por ele o Intra sabe que esta mensagem pertence
      // a um chamado que já existe, e posta a resposta do cliente como nota ali
      // em vez de abrir outro chamado do mesmo assunto.
      // cabecalhos: só os que denunciam resposta automática (férias, "recebemos
      // sua mensagem"). Com eles a triagem separa a máquina antes de virar nota.
      mensagens.push({ id: m.getId(), de: m.getFrom(), assunto: m.getSubject() || '', data: m.getDate().toISOString(),
        message_id: m.getHeader('Message-ID') || '', thread_id: th.getId(),
        cabecalhos: { 'Auto-Submitted': m.getHeader('Auto-Submitted') || '', 'X-Autoreply': m.getHeader('X-Autoreply') || '',
          'X-Autorespond': m.getHeader('X-Autorespond') || '', 'Precedence': m.getHeader('Precedence') || '' },
        trecho: (m.getPlainBody() || '').slice(0, 2000) });
    });
  });
  if (!mensagens.length) return;  // ao contrário dos backups, silêncio aqui não é notícia
  var r = roboChamar_('triagem', { mensagens: mensagens });
  p.setProperty('TRIAGEM_EMAIL_DESDE', String(maisNovo));
  // `internos` são as nossas próprias respostas dentro da conversa: o robô lê
  // a thread inteira, e elas não são pedido novo. `notas` são as respostas do
  // cliente que caíram no chamado que a conversa já tinha aberto.
  Logger.log('Triagem: ' + mensagens.length + ' e-mail(s), ' + r.abertas + ' pendência(s), '
    + (r.notas ? r.notas + ' nota(s) em chamado aberto, ' : '')
    + r.ignorados + ' ignorado(s)' + (r.internos ? ', ' + r.internos + ' da própria Init' : '')
    + (r.auto_respostas ? ', ' + r.auto_respostas + ' resposta(s) automática(s)' : '')
    + ((r.sem_cliente || []).length ? ', sem cliente: ' + r.sem_cliente.join(' | ') : ''));
}

// ── Madrugada: domínios, indicadores, backup ────────────────────────────────

function roboNoite() {
  var erros = [];
  [['domínios', roboDominios], ['indicadores', roboIndicadores], ['backup', roboBackup], ['pastas', roboPastas]].forEach(function (t) {
    try { t[1](); } catch (e) { erros.push(t[0] + ': ' + e.message); }
  });
  if (erros.length) throw new Error(erros.join(' | '));  // aparece em Execuções
}

function roboDominios() {
  var r = roboChamar_('dominios');
  Logger.log('Domínios verificados: ' + r.verificados);
}

function roboIndicadores() {
  var r = roboChamar_('indicadores');
  var ss = planilha_();
  Object.keys(r.abas).forEach(function (nome) {
    var linhas = r.abas[nome].map(function (l) { return l.map(function (c) { return c === null ? '' : c; }); });
    var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    sh.clearContents();
    if (!linhas.length) return;
    sh.getRange(1, 1, linhas.length, linhas[0].length).setValues(linhas);
    sh.getRange(1, 1, 1, linhas[0].length).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var sobre = ss.getSheetByName('Atualização') || ss.insertSheet('Atualização');
  sobre.getRange(1, 1, 2, 2).setValues([['Atualizado em', new Date(r.atualizado_em)],
    ['Origem', 'Init Intra (robô). Não edite: tudo é reescrito toda madrugada.']]);
  ['Página1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

function planilha_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('IND_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* apagada: cria de novo */ }
  }
  var ss = SpreadsheetApp.create('Init Intra — Indicadores');
  p.setProperty('IND_SHEET_ID', ss.getId());
  return ss;
}

function roboBackup() {
  var r = roboChamar_('backup');
  var nomes = Object.keys(r.erros || {});
  if (nomes.length) Logger.log('Tabelas fora do backup: ' + nomes.join(', '));
  var pasta = pastaBackup_();
  var dia = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  var nome = 'init-intra-backup-' + dia + '.json';
  var mesmos = pasta.getFilesByName(nome);
  while (mesmos.hasNext()) mesmos.next().setTrashed(true);  // rodou 2× no dia: fica o último
  pasta.createFile(nome, JSON.stringify(r), 'application/json');

  var limite = Date.now() - BACKUP_DIAS * 86400000;
  var files = pasta.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (/^init-intra-backup-/.test(f.getName()) && f.getDateCreated().getTime() < limite) f.setTrashed(true);
  }
}

function pastaBackup_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* apagada: cria de novo */ }
  }
  var pasta = DriveApp.createFolder('Init Intra — Backups');
  p.setProperty('BACKUP_FOLDER_ID', pasta.getId());
  return pasta;
}

// Pasta do Drive de cada cliente (069). Quem tem planilha e não tem pasta ganha
// a pasta-mãe da planilha; quem não tem nenhuma das duas é procurado pelo nome em
// CLIENTES_ROOT_ID (uma → vincula, nenhuma → cria, várias → só reporta); quem tem
// pasta é conferido, renomeado para o nome do Intra e movido para a raiz. Nada é
// apagado: órfãs e ambíguas só saem no log. Mover exige Gerente de conteúdo no drive.
function roboPastas() {
  var r = roboChamar_('pastas');
  var buscar = r.buscar || [];
  var achados = [], testes = [], erros = [], ambiguas = [], orfas = [];
  var n = { criadas: 0, reusadas: 0, renomeadas: 0, movidas: 0 };
  var rootId = String(PropertiesService.getScriptProperties().getProperty('CLIENTES_ROOT_ID') || '').trim();
  var root = null;
  if (!rootId) erros.push('CLIENTES_ROOT_ID vazio: nada criado, movido nem listado');
  else {
    try { root = DriveApp.getFolderById(rootId); } catch (e) { erros.push('CLIENTES_ROOT_ID inacessível: ' + e.message); }
  }
  if (root) buscar.forEach(function (c) {
    try {
      // Procura antes de criar: cliente antigo pode ter pasta sem vínculo, e a
      // pasta criada ontem cuja gravação falhou é reaproveitada hoje.
      var vivas = [], it = root.getFoldersByName(c.nome);
      while (it.hasNext()) { var x = it.next(); if (!x.isTrashed()) vivas.push(x); }
      if (vivas.length > 1) { ambiguas.push(c.nome + ': ' + vivas.length + ' pastas'); return; }
      var f = vivas[0];
      if (f) n.reusadas++; else { f = root.createFolder(c.nome); n.criadas++; }
      achados.push({ client_id: c.client_id, folder_id: f.getId(), folder_url: f.getUrl() });
    } catch (e) { erros.push(c.client_id + ': ' + e.message); }
  });
  r.candidatos.forEach(function (c) {
    try {
      var pais = DriveApp.getFileById(c.sheet_id).getParents();
      while (pais.hasNext()) {
        var f = pais.next();
        if (f.isTrashed()) continue;
        // Planilha solta na raiz: vincular a pasta-mãe daria a raiz inteira a um cliente.
        if (rootId && f.getId() === rootId) { ambiguas.push(c.client_id + ': planilha solta na raiz'); break; }
        achados.push({ client_id: c.client_id, folder_id: f.getId(), folder_url: f.getUrl() });
        break;
      }
    } catch (e) { erros.push(c.client_id + ': ' + e.message); }  // planilha sem acesso: tenta de novo amanhã
  });
  r.vigiar.forEach(function (v) {
    var f = null;
    try { f = DriveApp.getFolderById(v.folder_id); if (f.isTrashed()) f = null; } catch (e) { f = null; /* apagada ou sem acesso */ }
    testes.push({ client_id: v.client_id, status: f ? 'ok' : 'inacessivel' });
    // Sem nome (função antiga) ou pasta de vários clientes: só confere, não mexe.
    if (!f || !v.nome || v.compartilhada) return;
    try {
      if (f.getName() !== v.nome) { f.setName(v.nome); n.renomeadas++; }
      if (root && !temPai_(f, rootId)) { f.moveTo(root); n.movidas++; }
    } catch (e) { erros.push(v.client_id + ': ' + e.message); }  // a pasta segue ok; tenta de novo amanhã
  });
  if (root) {
    var conhecidas = {};
    r.vigiar.forEach(function (v) { conhecidas[v.folder_id] = true; });
    achados.forEach(function (a) { conhecidas[a.folder_id] = true; });
    var filhas = root.getFolders();
    while (filhas.hasNext()) {
      var x = filhas.next();
      if (!x.isTrashed() && !conhecidas[x.getId()]) orfas.push(x.getName());
    }
  }
  var g = roboChamar_('pastas-resultado', {
    achados: achados.map(function (a) { return { client_id: a.client_id, folder_url: a.folder_url }; }),
    testes: testes, erros: erros, ambiguas: ambiguas, orfas: orfas,
  });
  Logger.log('Pastas vinculadas: ' + g.gravados + ' | conferidas: ' + g.atualizados + ' | criadas: ' + n.criadas +
    ' | reusadas: ' + n.reusadas + ' | renomeadas: ' + n.renomeadas + ' | movidas: ' + n.movidas +
    ' | ambíguas: ' + ambiguas.length + ' | órfãs: ' + orfas.length + (erros.length ? ' | erros: ' + erros.length : ''));
  if (ambiguas.length) Logger.log('Ambíguas: ' + ambiguas.slice(0, 50).join('; '));
  if (orfas.length) Logger.log('Órfãs na raiz: ' + orfas.slice(0, 50).join('; '));
}

function temPai_(f, id) {
  var pais = f.getParents();
  while (pais.hasNext()) if (pais.next().getId() === id) return true;
  return false;
}
