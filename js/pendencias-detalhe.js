// pendencias-detalhe.js – Detalhe e formulário da pendência.
// Parte de pendencias.js (dividido para facilitar manutenção). Scripts clássicos:
// carregam logo depois de pendencias.js e compartilham os mesmos globais.
// Nos testes, tests/_parts.cjs junta as partes na mesma ordem.

function openPendenciaDetail(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  try {
    if (typeof canViewPendencia === 'function' && !canViewPendencia(p)) {
      if (typeof showToast === 'function') showToast('Acesso restrito à Gestão.', 'error');
      return;
    }
  } catch (_) {}
  const c = getClientById(p.clientId);
  const _worker = (typeof getCurrentWorker === 'function') ? getCurrentWorker(p) : null;
  const _ft = _penFriendlyTime(p);
  const _attCount = (typeof getAttachments === 'function') ? (getAttachments('pendencias', id) || []).length : 0;
  const _stMeta = (typeof STATUS_PEN_MAP !== 'undefined' && STATUS_PEN_MAP[p.status]) ? STATUS_PEN_MAP[p.status] : { label: p.status || '—', dot: '#94a3b8' };
  const _isOverdue = !!(p.deadline && typeof localDateISO === 'function' && p.deadline < localDateISO() && typeof isPendenciaClosed === 'function' && !isPendenciaClosed(p.status));
  const _isHighPri = (p.priority === 'alta' || p.priority === 'critica');
  const _checkList = Array.isArray(p.checklist) ? p.checklist : [];
  const _checkDone = _checkList.filter(function(it){ return it && it.done; }).length;
  const _me = (typeof getUser === 'function' && getUser()) ? getUser().name : '';
  // Chamado aberto pela triagem de e-mail (064): dá para responder a quem
  // pediu sem sair daqui. Sem endereço, a opção nem aparece.
  const _emailDestino = String(p.solicitanteEmail || '').trim();
  // O bloco de origem sai da descrição e vira cartão — inclusive nos chamados
  // antigos, que é onde ele está feio hoje.
  const _penDesc = _penOrigemTriagem(p.descricao);
  // O e-mail inteiro (066) só ganha o "ver mais" quando tem o que mostrar: a
  // descrição já é o começo dele, e repetir o mesmo texto duas vezes na tela
  // é pior do que não ter o botão.
  const _emailCorpo = String(p.emailCorpo || '').trim();
  const _emailInteiro = _emailCorpo.length > _penDesc.corpo.length + 40 ? _emailCorpo : '';
  openModal(`${penDisplayNumber(p)} – ${escapeHtml(getPendenciaTitulo(p))}`, `
    <div class="pen-detail pen-cmd" data-status="${escapeHtml(p.status||'')}">
    <!-- ══ CABEÇALHO COMANDO: badge + timer primário + editar sutil ══ -->
    <div class="pen-cmd-header">
      <div class="pen-cmd-status-row">
        <span class="pen-cmd-badge" id="cmdStatusBadge" style="--st-dot:${escapeHtml(_stMeta.dot)}"><span class="pen-cmd-dot" aria-hidden="true"></span>${escapeHtml(_stMeta.label)}</span>
        <div class="pen-status-wrap pen-cmd-status-edit">
          <select class="form-select pen-status-select pen-cmd-select" id="chgStatus" title="Alterar status (salva na hora)" onchange="cmdStatusPreview(this);changePenStatus('${escapeHtml(id)}')">
            ${(STATUS_PEN_MAP[p.status] ? '' : `<option value="${escapeHtml(p.status || '')}" selected disabled>${escapeHtml({ concluido: 'Concluído', fechado: 'Fechado' }[p.status] || p.status || '—')} (antigo)</option>`) + Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}
          </select>
        </div>
        ${priorityTag(p.priority)}
      </div>
      <div class="pen-cmd-top-actions">
        <div class="timer-row pen-cmd-timer" title="${_worker ? _escapeHtmlFallback(_worker)+' trabalhando — clique ⏸ para pausar' : 'Ninguém trabalhando — clique ▶ para iniciar'}">${timerWidget(p, 'pendencia')}</div>
        <button class="pen-cmd-edit" title="Editar todos os campos" aria-label="Editar pendência" onclick="closeModal();openPendenciaForm('${escapeHtml(id)}')">✎</button>
      </div>
    </div>
    <!-- Linha compacta de trabalho (mantém contrato pen-work p/ timer.js + teste mobile) -->
    <div class="pen-work ${_worker ? 'is-working' : 'is-free'} pen-cmd-work" title="${_worker ? _escapeHtmlFallback(_worker) + ' está trabalhando nesta pendência' : 'Ninguém trabalhando agora — inicie pelo botão verde acima'}">
      <span class="pen-work-dot" aria-hidden="true"></span>
      <div class="pen-work-text">
        <span class="pen-work-label">Trabalhando agora</span>
        <span class="pen-work-value">${_worker
          ? `<strong>${_escapeHtmlFallback(_worker)}</strong> <span class="pen-work-time">${timerDisplayHTML(p)}</span>`
          : `<strong>Ninguém</strong> <span class="pen-work-hint">· Disponível</span>`}</span>
      </div>
      <div class="pen-work-side">
        <span class="pen-work-label">Tempo acumulado</span>
        <span class="pen-time" title="Tempo total exato: ${_escapeHtmlFallback(_ft.exact)}">⏱ ${_escapeHtmlFallback(_ft.friendly)}</span><button type="button" class="link-btn pen-sessions" onclick="openTimeEntries('${escapeHtml(id)}')" title="Ver, corrigir ou lançar horas">Sessões</button>
      </div>
    </div>

    <div class="pen-cmd-grid">
      <!-- ══ COLUNA ESQUERDA (65%): contexto + feed ══ -->
      <section class="pen-cmd-main">
        <div class="ticket-info-item pen-assunto pen-cmd-assunto"><div class="ticket-info-label">Assunto</div><div class="ticket-info-value">${escapeHtml(getPendenciaAssunto(p))||'<span style="color:var(--text-muted)">Não preenchido (registro anterior à separação assunto/descrição)</span>'}</div></div>
        <div class="pen-desc-block pen-cmd-desc"><div class="pen-section-label">Descrição · Contexto</div><div class="pen-desc">${_penRichDesc(_penDesc.corpo)||'—'}</div>
        ${_penOrigemHtml(_penDesc.origem)}
        ${_penDesc.depois ? `<div class="pen-desc pen-desc-depois">${_penRichDesc(_penDesc.depois)}</div>` : ''}
        ${_emailInteiro ? `<details class="pen-email-full"><summary>Ver o e-mail inteiro (${_emailInteiro.length.toLocaleString('pt-BR')} caracteres)</summary><div class="pen-email-corpo">${_penRichDesc(_emailInteiro)}</div></details>` : ''}
        ${p.linkUtil && safeUrl(p.linkUtil) !== '#' ?`<div style="margin-top:10px"><a href="${safeUrl(p.linkUtil)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="${escapeHtml(p.linkUtil)}">🔗 Abrir link útil</a></div>`:''}
        </div>
        ${typeof kbPendenciaPanelHtml === 'function' ? kbPendenciaPanelHtml(p) : ''}

        <div class="pen-cmd-card pen-cmd-feed-card">
          <div class="section-header pen-sec-head"><span class="section-title">💬 Feed de atividade</span><span class="pen-count">${(p.notes||[]).length ? (p.notes||[]).length+' msgs' : '0 msgs'}</span></div>
          <div class="pen-cmd-feed" id="penTimeline">
            ${_penFeedItens(p).length ? _penFeedItens(p).map(function(n){
              if (n._evento) return _penEventoHtml(n);
              var _isMe = _me && n.author === _me;
              var _ini = String(n.author||'?').trim().split(/\\s+/).map(function(w){return (w[0]||'').toUpperCase();}).slice(0,2).join('') || '?';
              // Sem o campo = nota anterior à separação: lida como interna.
              // 'solicitante' (065) é a fala de quem PEDIU, que chegou por e-mail
              // na conversa do chamado: não é nossa nem é segredo da equipe, então
              // não pode ler como 🔒 interna.
              var _doSolic = n.visibility === 'solicitante';
              var _interna = !_doSolic && n.visibility !== 'resposta';
              return '<div class="feed-msg'+(_isMe?' is-me':'')+(_interna?' is-interna':'')+(_doSolic?' is-solicitante':'')+'">'
                + '<span class="feed-avatar" title="'+escapeHtml(n.author||'')+'">'+escapeHtml(_ini)+'</span>'
                + '<div class="feed-bubble"><div class="feed-meta"><strong>'+escapeHtml(n.author)+'</strong><span> · '+formatDateTime(n.createdAt)+'</span>'
                + (_doSolic ? '<span class="feed-tag-solicitante" title="Chegou por e-mail, na conversa do chamado">✉ do solicitante</span>' : '')
                + (_interna ? '<span class="feed-tag-interna" title="Visível só para a equipe">🔒 interna</span>' : '')
                + '</div>'
                + '<div class="pen-note-text feed-text">'+_penRichNote(n.text)+'</div></div></div>';
            }).join('') : '<p class="text-muted pen-cmd-empty">Nenhuma nota ainda. Poste a primeira atualização abaixo 👇</p>'}
          </div>
          <div class="pen-cmd-composer" id="penComposer" data-vis="resposta">
            <div class="pen-cmd-vis" role="tablist" aria-label="Destino da mensagem">
              <button type="button" class="pen-vis-tab is-on" role="tab" aria-selected="true" data-action="penNoteVis" data-arg="resposta"
                title="Fica visível para quem pediu e conta como 1ª resposta no SLA">Resposta</button>
              <button type="button" class="pen-vis-tab" role="tab" aria-selected="false" data-action="penNoteVis" data-arg="interna"
                title="Só a equipe vê; não conta como 1ª resposta">🔒 Anotação interna</button>
            </div>
            <textarea class="form-textarea" id="newNoteText" rows="3" placeholder="O que foi feito? Decisões tomadas? (Ctrl+Enter envia · @nome menciona)"></textarea>
            ${_emailDestino ? `<label class="pen-cmd-email" id="penNoteEmailWrap" title="Vai na mesma conversa de e-mail em que ${escapeHtml(_emailDestino)} escreveu">
              <input type="checkbox" id="penNoteEmail" checked>
              <span>Enviar por e-mail para <strong>${escapeHtml(_emailDestino)}</strong></span>
            </label>` : ''}
            <div class="pen-cmd-composer-bar">
              <div class="pen-cmd-tools">
                <label class="btn btn-secondary btn-sm pen-cmd-tool" style="cursor:pointer" title="Anexar arquivo (máx 2MB)">📎 Anexar
                  <input type="file" id="penFileInput" style="display:none" onchange="handleFileUpload('pendencias','${id}',this,()=>{renderAttachmentList('pendencias','${id}','penAttachmentsList');cmdRefreshAttCount('${escapeHtml(id)}')})" />
                </label>
                <button type="button" class="btn btn-secondary btn-sm pen-cmd-tool" title="Ir para o checklist" onclick="cmdFocusChecklist()">☑️ Checklist</button>
              </div>
              <button type="button" class="btn btn-primary pen-cmd-post" onclick="submitPenNote('${escapeHtml(id)}')">📝 Postar Atualização</button>
            </div>
          </div>
        </div>
      </section>

      <!-- ══ COLUNA DIREITA (35%): metadados + ferramentas ══ -->
      <aside class="pen-cmd-side">
        <div class="pen-cmd-card">
          <div class="pen-section-label">Propriedades</div>
          <dl class="pen-props pen-cmd-props">
            <div class="pen-prop"><dt>Cliente</dt><dd>${c?`<span class="pen-client">${clientAvatar(c,22)}<span>${escapeHtml(p.clientName)}</span></span>`:escapeHtml(p.clientName)||'—'}</dd></div>
            <div class="pen-prop"><dt>Tipo</dt><dd>${escapeHtml(p.tipo)||'—'}</dd></div>
            ${typeof penCategoriaOptionsHtml === 'function' ? `
            <div class="pen-prop"><dt>Solicitante</dt><dd><span class="pen-inline-wrap">${escapeHtml(p.solicitante)||'—'}<button class="pen-inline-edit" title="Alterar solicitante" aria-label="Alterar solicitante" data-action="penEditSolicitante" data-arg="${escapeHtml(id)}">✏️</button></span></dd></div>
            <div class="pen-prop"><dt>Canal</dt><dd><span class="pen-inline-wrap">${escapeHtml(penCanalLabel(p.canal))||'—'}<select class="pen-inline-select" title="Alterar canal" aria-label="Alterar canal" data-change="penSetField" data-field="canal" data-id="${escapeHtml(id)}">${penCanalOptionsHtml(p.canal||'')}</select></span></dd></div>
            <div class="pen-prop"><dt>Categoria</dt><dd><span class="pen-inline-wrap">${escapeHtml(penCategoriaLabel(p.categoria))||'—'}<select class="pen-inline-select" title="Alterar categoria" aria-label="Alterar categoria" data-change="penSetField" data-field="categoria" data-id="${escapeHtml(id)}">${penCategoriaOptionsHtml(p.categoria||'')}</select></span></dd></div>
            <div class="pen-prop"><dt>1ª resposta</dt><dd>${penRespostaBadge(p, Date.now(), { full: true })}</dd></div>
            <div class="pen-prop"><dt>Resolução</dt><dd>${typeof penResolucaoBadge === 'function' ? penResolucaoBadge(p, Date.now(), { full: true }) : ''}</dd></div>
            ${typeof penTempoPorLadoHtml === 'function' ? `<div class="pen-prop"><dt>Tempo</dt><dd>${penTempoPorLadoHtml(p, Date.now())}</dd></div>` : ''}` : ''}
            <div class="pen-prop"><dt>Responsável</dt><dd><span class="pen-inline-wrap">${escapeHtml(p.responsible)||'—'}<button class="pen-inline-edit" title="Alterar responsável" onclick="openReassignPendencia('${escapeHtml(id)}')">✏️</button></span></dd></div>
            <div class="pen-prop"><dt>Prioridade</dt><dd><span class="pen-inline-wrap">${priorityTag(p.priority)}<select class="pen-inline-select" title="Alterar prioridade" onchange="quickUpdatePendenciaField('${escapeHtml(id)}','priority',this.value)">${['baixa','media','alta','critica'].map(v=>`<option value="${v}" ${p.priority===v?'selected':''}>${v==='baixa'?'Baixa':v==='media'?'Média':v==='alta'?'Alta':'Crítica'}</option>`).join('')}</select></span></dd></div>
            <div class="pen-prop${_isOverdue?' is-alert':''}"><dt>Prazo</dt><dd><span class="pen-inline-wrap">${p.deadline?formatDate(parseDeadline(p.deadline)):'Sem prazo'}<input type="date" class="pen-inline-date" title="Alterar prazo" value="${escapeHtml(p.deadline||'')}" onchange="quickUpdatePendenciaField('${escapeHtml(id)}','deadline',this.value)" /></span>${_isOverdue?'<span class="pen-cmd-flag">⚠️ Vencido</span>':''}${(!p.deadline && _isHighPri)?'<span class="pen-cmd-flag warn">⚠ Sem prazo · prioridade '+escapeHtml(p.priority)+'</span>':''}</dd></div>
            <div class="pen-prop"><dt>Aberto em</dt><dd>${formatDate(p.createdAt)}</dd></div>
          </dl>
        </div>

        <div class="pen-cmd-card" id="penCmdCheckCard">
          <div class="section-header pen-sec-head"><span class="section-title">☑ Checklist</span><span class="pen-count" id="penCheckCounter">${_checkList.length ? _checkDone+'/'+_checkList.length : ''}</span></div>
          <div class="pen-cmd-progress" title="${_checkDone} de ${_checkList.length} concluídos"><div class="pen-cmd-progress-bar" id="penCheckProgressBar" style="width:${_checkList.length ? Math.round(_checkDone/_checkList.length*100) : 0}%"></div></div>
          <div class="pen-cmd-progress-label" id="penCheckProgressLabel">${_checkList.length ? _checkDone+'/'+_checkList.length+' concluídos' : 'Nenhum item — quebre a entrega em passos'}</div>
          <div id="penChecklist"></div>
          <div class="pen-check-add">
            <input class="form-input" id="newCheckItem" placeholder="Adicionar item... (Enter adiciona)" onkeydown="if(event.key==='Enter'){event.preventDefault();addCheckItem('${escapeHtml(id)}')}" />
            <button class="btn btn-sm btn-secondary" title="Adicionar item ao checklist" onclick="addCheckItem('${escapeHtml(id)}')">+ Adicionar</button>
          </div>
        </div>

        <div class="pen-cmd-card pen-cmd-drop" id="penDropzone" ondragover="event.preventDefault();this.classList.add('dragover')" ondragleave="this.classList.remove('dragover')" ondrop="event.preventDefault();this.classList.remove('dragover');cmdDropFiles(event,'${escapeHtml(id)}')">
          <div class="section-header pen-sec-head">
            <span class="section-title">📎 Anexos <span class="pen-count" id="penAttCounter"${_attCount?'':' style="display:none"'}>${_attCount||''}</span></span>
            <label class="btn btn-secondary btn-sm" style="cursor:pointer" title="Anexar arquivo (máx 2MB)">+ Anexar
              <input type="file" id="penFileInputSide" style="display:none" onchange="handleFileUpload('pendencias','${id}',this,()=>{renderAttachmentList('pendencias','${id}','penAttachmentsList');cmdRefreshAttCount('${escapeHtml(id)}')})" />
            </label>
          </div>
          <div class="pen-cmd-drop-hint">Arraste e solte aqui <span>· Máx 2MB por arquivo · cole print com Ctrl+V na nota</span></div>
          <div class="attachment-list" id="penAttachmentsList"></div>
        </div>

        <div class="pen-cmd-side-actions">
          <button class="btn btn-secondary btn-sm" title="Criar uma cópia desta pendência" onclick="duplicatePendencia('${escapeHtml(id)}')">⧉ Duplicar</button>
        </div>
      </aside>
    </div>
    </div>
  `, 'lg drawer');
  setTimeout(() => {
    renderAttachmentList('pendencias', id, 'penAttachmentsList');
    renderPenChecklist(id);
    try { cmdStatusSync(); } catch (_) {}
    try {
      var _feed = document.getElementById('penTimeline');
      if (_feed) _feed.scrollTop = _feed.scrollHeight;
    } catch (_) {}
    var ta = document.getElementById('newNoteText');
    if (ta && !ta.dataset.cmdKeys) {
      ta.dataset.cmdKeys = '1';
      ta.addEventListener('keydown', function(e){
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitPenNote(id); }
      });
    }
    if (ta && !ta.dataset.clipboardBound) {
      ta.dataset.clipboardBound='1';
      ta.addEventListener('paste', function(e){
        if(!e.clipboardData || !e.clipboardData.items) return;
        var items=e.clipboardData.items;
        for(var i=0;i<items.length;i++){
          var item=items[i];
          if(item.type && item.type.startsWith('image/')){
            e.preventDefault();
            var file=item.getAsFile();
            if(!file) continue;
            if(!file.name) { try{ Object.defineProperty(file,'name',{value:'clipboard-'+Date.now()+'.png'}); }catch(_){ file.name='clipboard-'+Date.now()+'.png'; } }
            (async function(f){
              var attId='ATT-'+Date.now()+'-'+_secureRandStr(4);
              var url=null,path=null,data=null;
              try{ var up=await _uploadAttachmentToStorage('pendencias', id, attId, f); if(up){ url=up.url; path=up.path; } }catch(_){}
              if(!url){
                try{ data=await new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){res(r.result);}; r.onerror=rej; r.readAsDataURL(f); }); }catch(_){}
              }
              var result=addAttachment('pendencias', id, {id:attId, name:f.name, mimeType:f.type, size:f.size, data:data, url:url, path:path});
              if(result && result.error){ if(typeof showToast==='function') showToast(result.error,'error'); }
              else { if(typeof showToast==='function') showToast('Imagem anexada via clipboard','success'); renderAttachmentList('pendencias', id, 'penAttachmentsList'); }
            })(file);
            break;
          }
        }
      });
    }
  }, 20);
}

function changePenStatus(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  const newStatus = document.getElementById('chgStatus').value;
  // Cópia destacada (ver onPenKanbanDrop): preserva a detecção de transição
  // que gera a próxima ocorrência recorrente em savePendencia.
  const next = { ...p, status: newStatus };
  // Auto-stop: concluir/cancelar/fechar com timer rodando congela o tempo
  // acumulado em vez de deixar o cronômetro fantasma acumulando.
  try {
    var _closed = (typeof isPendenciaClosed === 'function') ? isPendenciaClosed(newStatus) : ['concluido', 'resolvido', 'cancelado', 'fechado'].includes(newStatus || '');
    if (_closed && p.timerRunning) {
      var _el = 0;
      if (p.timerStartedAt) { _el = Math.max(0, Math.floor((Date.now() - new Date(p.timerStartedAt).getTime()) / 1000)); }
      next.timerTotalSeconds = (Number(p.timerTotalSeconds) || 0) + _el;
      if (typeof timerClosedSessionNote === 'function') next.notes = [...(p.notes || []), timerClosedSessionNote(p.timerOperator, _el, next.timerTotalSeconds)];
      if (typeof recordTimeSession === 'function') recordTimeSession(p, _el, { source: 'conclusao' });
      next.timerRunning = false;
      next.timerStartedAt = null;
      next.timerOperator = null;
    }
  } catch (_) {}
  savePendencia(next);
  _optimisticPenUpsert(next); // reflete na lista na hora; o fetch reconcilia depois
  updateBadges();
  showToast('Status atualizado!', 'success');
  openPendenciaDetail(id);
  if (typeof renderPenView === 'function' && document.getElementById('penViewArea')) renderPenView(false);
  if (typeof refreshCalendar === 'function' && document.getElementById('calendarContainer')) refreshCalendar();
}

// ── Linha do tempo (063): notas e eventos no MESMO fio, em ordem ──────────
// Quem lê o chamado quer a história inteira, não duas listas para cruzar.

/** Notas + eventos ordenados por data. Evento vem marcado com `_evento`. */
// A triagem (robo/campo.ts) cola um bloco de origem no FIM da descrição:
//
//   — Aberta pela triagem de e-mail do Init Intra.
//   De: Márcia <m@acme.com.br>
//   Recebido em: 2026-10-26T09:00:00.000Z
//   Assunto original: impressora não imprime
//
// Metadado como texto corrido é o que dá a cara de cru: entra na busca, entra
// na prévia do card, e quem lê tem de pular aquilo para achar o pedido.
// Separar na RENDERIZAÇÃO, e não na gravação, conserta também os chamados que
// já existem — e são esses que estão feios hoje.
var PEN_ORIGEM_MARCA = /\n*—[ \t]*Aberta pela triagem de ([^\n.]{1,40}?) do Init Intra\.?[ \t]*\n?/;

/** Só estes rótulos são do carimbo; qualquer outra linha depois dele é texto da pessoa. */
var PEN_ORIGEM_CAMPOS = { 'de': 'de', 'recebido em': 'recebidoEm', 'assunto original': 'assuntoOriginal' };

/**
 * Separa a descrição em { corpo, origem, depois }. Sem o bloco, origem é null.
 *
 * `depois` é o texto que veio DEPOIS do carimbo: ao editar um chamado
 * nascido de triagem, o cursor cai no fim da descrição — que é justamente
 * depois do carimbo — e é ali que a pessoa digita. Antes disso, o que fosse
 * escrito ali era descartado: não estava no corpo, e a linha não era um
 * campo do carimbo. Desaparecia da tela de detalhe sem sumir do banco.
 */
function _penOrigemTriagem(descricao) {
  var s = String(descricao || '');
  var m = PEN_ORIGEM_MARCA.exec(s);
  if (!m) return { corpo: s.trim(), origem: null, depois: '' };
  var campos = { de: '', recebidoEm: '', assuntoOriginal: '' };
  var depois = [];
  s.slice(m.index + m[0].length).split('\n').forEach(function (linha) {
    var mm = /^[ \t]*([^:]{2,30}):[ \t]*(.+?)[ \t]*$/.exec(linha);
    var chave = mm ? mm[1].trim().toLowerCase() : '';
    if (mm && PEN_ORIGEM_CAMPOS[chave]) campos[PEN_ORIGEM_CAMPOS[chave]] = mm[2].trim();
    else depois.push(linha);
  });
  return {
    corpo: s.slice(0, m.index).trim(),
    origem: {
      canal: m[1].trim(),
      de: campos.de,
      recebidoEm: campos.recebidoEm,
      assuntoOriginal: campos.assuntoOriginal
    },
    depois: depois.join('\n').trim()
  };
}

/** Cartão de origem do chamado nascido de triagem. Vazio quando não houve. */
function _penOrigemHtml(origem) {
  if (!origem) return '';
  var ehEmail = /e-?mail/i.test(origem.canal);
  var linha = function (rot, val) {
    return val ? '<div class="pen-origem-item"><dt>' + escapeHtml(rot) + '</dt><dd>' + escapeHtml(val) + '</dd></div>' : '';
  };
  // A data vem em ISO do robô; formatDateTime deixa legível, mas um registro
  // antigo pode trazer qualquer coisa — então só formata o que o Date entende.
  var quando = origem.recebidoEm;
  try {
    if (Date.parse(origem.recebidoEm) && typeof formatDateTime === 'function') {
      quando = formatDateTime(origem.recebidoEm);
    }
  } catch (_) {}
  return '<div class="pen-origem">'
    + '<div class="pen-origem-head">' + (ehEmail ? '✉' : '💬') + ' Chegou por ' + escapeHtml(origem.canal) + '</div>'
    + '<dl class="pen-origem-lista">'
    + linha('De', origem.de)
    + linha('Recebido', quando)
    + linha('Assunto original', origem.assuntoOriginal)
    + '</dl></div>';
}

function _penFeedItens(p) {
  var notas = Array.isArray(p && p.notes) ? p.notes : [];
  var eventos = (Array.isArray(p && p.events) ? p.events : []).map(function(e) {
    return { _evento: true, createdAt: e.at, author: e.by, type: e.type, de: e.de, para: e.para };
  });
  return notas.concat(eventos).sort(function(a, b) {
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

/** Rótulo legível de um valor, resolvido AGORA (renomear status não reescreve o histórico). */
function _penValorLabel(tipo, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (tipo === 'status') {
    try { return (STATUS_PEN_MAP && STATUS_PEN_MAP[v] && STATUS_PEN_MAP[v].label) || v; } catch (_) { return v; }
  }
  if (tipo === 'prioridade') {
    try { return typeof penPriLabel === 'function' ? penPriLabel(v) : v; } catch (_) { return v; }
  }
  if (tipo === 'prazo') {
    try { return typeof formatDate === 'function' ? formatDate(parseDeadline(v)) : v; } catch (_) { return v; }
  }
  return v;
}

const _PEN_EVENT_VERBO = {
  criado: 'abriu a pendência',
  status: 'mudou o status',
  responsavel: 'passou para',
  prioridade: 'mudou a prioridade',
  prazo: 'mudou o prazo',
};

/** Marcador discreto no meio do fio — não é balão de mensagem. */
function _penEventoHtml(e) {
  var quem = e.author ? escapeHtml(e.author) : 'Sistema';
  var corpo;
  if (e.type === 'criado') {
    corpo = quem + ' ' + _PEN_EVENT_VERBO.criado;
  } else if (e.type === 'responsavel') {
    corpo = quem + ' ' + _PEN_EVENT_VERBO.responsavel + ' <strong>' + escapeHtml(_penValorLabel(e.type, e.para)) + '</strong>';
  } else {
    corpo = quem + ' ' + (_PEN_EVENT_VERBO[e.type] || 'mudou algo')
      + ': <span class="pen-ev-de">' + escapeHtml(_penValorLabel(e.type, e.de)) + '</span>'
      + ' → <strong>' + escapeHtml(_penValorLabel(e.type, e.para)) + '</strong>';
  }
  return '<div class="pen-ev" role="note"><span class="pen-ev-txt">' + corpo
    + '</span><span class="pen-ev-at">' + formatDateTime(e.createdAt) + '</span></div>';
}

/** Alterna Resposta × Anotação interna no compositor (delegado por data-action). */
function penNoteVis(vis) {
  var box = document.getElementById('penComposer');
  if (!box) return;
  var alvo = vis === 'interna' ? 'interna' : 'resposta';
  box.setAttribute('data-vis', alvo);
  box.querySelectorAll('.pen-vis-tab').forEach(function(b) {
    var on = b.getAttribute('data-arg') === alvo;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  // Anotação interna não vai para o cliente: o envio por e-mail some junto.
  var emailWrap = document.getElementById('penNoteEmailWrap');
  if (emailWrap) emailWrap.style.display = alvo === 'interna' ? 'none' : '';
  var ta = document.getElementById('newNoteText');
  if (ta) {
    ta.placeholder = alvo === 'interna'
      ? 'Só a equipe vê. Contexto, combinados, o que não vai para o cliente. (@nome menciona)'
      : 'O que foi feito? Decisões tomadas? (Ctrl+Enter envia · @nome menciona)';
  }
}

function _penComposerVis() {
  var box = document.getElementById('penComposer');
  return box && box.getAttribute('data-vis') === 'interna' ? 'interna' : 'resposta';
}

function submitPenNote(id) {
  const ta = document.getElementById('newNoteText');
  const text = (ta ? ta.value : '').trim();
  if (!text) { showToast('Escreva a atualização antes de postar.', 'error'); return; }
  const vis = _penComposerVis();
  // Lido antes de salvar: openPendenciaDetail logo abaixo redesenha o modal
  // inteiro, e a caixinha deixa de existir.
  const _box = document.getElementById('penNoteEmail');
  const _mandarEmail = vis === 'resposta' && !!(_box && _box.checked);
  const ok = addPendenciaNote(id, text, getUser().name, vis);
  if (!ok) { showToast('Não foi possível salvar a nota (pendência não encontrada). Texto mantido.', 'error'); return; }
  showToast(vis === 'interna' ? 'Anotação interna salva (só a equipe vê).' : 'Resposta postada!', 'success');
  if (_mandarEmail) penResponderPorEmail(id, text);
  openPendenciaDetail(id);
  renderPenView(false);
}

/**
 * Manda a nota pública por e-mail a quem abriu o chamado, na mesma conversa.
 * A nota JÁ está salva quando isto roda: e-mail que não sai não desfaz o
 * registro, só avisa — o contrário perderia o trabalho do técnico.
 * O destinatário não vai daqui: a function lê o `solicitante_email` do
 * próprio chamado (ver supabase/functions/pendencia-responder/index.ts).
 */
function penResponderPorEmail(id, text) {
  var online = typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive;
  if (!online) {
    showToast('A nota foi salva, mas o e-mail não saiu: sem conexão com o servidor.', 'error');
    return;
  }
  supabaseClient.functions.invoke('pendencia-responder', { body: { pendencia_id: id, text: text } })
    .then(function (r) {
      var d = r && r.data;
      if ((r && r.error) || !d || d.success !== true) {
        var msg = (d && d.error) || (r && r.error && r.error.message) || 'erro desconhecido';
        showToast('A nota foi salva, mas o e-mail não saiu: ' + msg, 'error');
        return;
      }
      showToast(d.threaded
        ? 'E-mail enviado para ' + d.to + '.'
        : 'E-mail enviado para ' + d.to + ' — como conversa nova (o original não trouxe Message-ID).', 'success');
    })
    .catch(function (e) {
      showToast('A nota foi salva, mas o e-mail não saiu.', 'error');
      if (typeof _logSilent === 'function') _logSilent(e, 'pendencias-detalhe:responder-email');
    });
}

// pre: valores iniciais de uma pendência nova (ex.: vindos da abertura rápida).
function openPendenciaForm(id = null, preClientId = null, preDate = null, pre = null) {
  const p           = id ? getPendenciaById(id) : Object.assign({}, pre || {});
  // Gestão: quem não é Gestão não abre edição de Gestão (link direto/ID).
  try {
    if (id && typeof canViewPendencia === 'function' && p && !canViewPendencia(p)) {
      if (typeof showToast === 'function') showToast('Acesso restrito à Gestão.', 'error');
      return;
    }
  } catch (_) {}
  const clients     = isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? getClientsByTeam(_selectedTeam) : getMyClients();
  const opNames     = getOperatorNames(isTeamAdmin() && typeof _selectedTeam !== 'undefined' && _selectedTeam ? _selectedTeam : getCurrentTeam());
  const currentResp = p.responsible || getUser().name;
  // Prazo pelo SLA da prioridade (só em pendência nova sem data escolhida).
  const _slaOn = typeof slaPrazoSugerido === 'function';
  const _prazoAuto = !id && !p.deadline && !preDate && _slaOn;
  const _prazoVal = p.deadline || preDate || (_prazoAuto ? slaPrazoSugerido(p.priority || 'media', localDateISO()) : '');
  // Gestão: esconde a opção Gestão de quem não é Gestão (Felipe/Joarli).
  var _canGest = true;
  try { _canGest = (typeof canViewGestao === 'function') ? canViewGestao() : true; } catch (_) {}
  var _tiposVisiveis = Array.isArray(typeof TIPOS !== 'undefined' ? TIPOS : []) ? TIPOS.filter(function(t){
    try { if (typeof isPendenciaGestao === 'function' && isPendenciaGestao({ tipo: t }) && !_canGest) return false; } catch (_) {}
    return true;
  }) : [];

  // Modelos de Procedimento servem de modelo de pendência (só na criação):
  // assunto, descrição e um checklist com os passos do modelo.
  const _tpls = (!id && typeof getProcedureTemplates === 'function') ? (getProcedureTemplates() || []) : [];
  const _tplField = _tpls.length ? `
      <div class="form-group pen-tpl-field"><label class="form-label" for="penTemplateSel">Começar de um modelo</label>
        <select class="form-select" id="penTemplateSel" onchange="applyPenTemplate(this.value)">
          <option value="">Em branco</option>
          ${_tpls.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.title || '—')}${t.category ? ' · ' + escapeHtml(t.category) : ''}</option>`).join('')}
        </select>
        <input type="hidden" name="templateChecklist" id="penTemplateChecklist" value="" />
        <div class="pen-tpl-hint" id="penTemplateHint" hidden></div></div>` : '';

  // Campos que vêm PRONTOS de fora (caixa de triagem, 066): o submit só
  // persiste o que existe como input do formulário, então sem estes hidden
  // solicitanteEmail, emailThreadId, emailMessageId e emailCorpo caem em
  // silêncio — e o chamado nasce sem o endereço de resposta, sem o corpo do
  // e-mail e sem o thread id que chamadoDaConversa usa para casar a conversa.
  // Só na criação: na edição o savePendencia mescla com o registro antigo e
  // nada se perde. O id da entrada também vem aqui — morre com o formulário
  // no cancelar, em vez de sobreviver numa variável de window.
  const _ocultos = !id
    ? [['etrEntrada', p.etrEntrada], ['solicitanteEmail', p.solicitanteEmail],
       ['emailThreadId', p.emailThreadId], ['emailMessageId', p.emailMessageId],
       ['emailCorpo', p.emailCorpo]]
      .filter(function (f) { return f[1] !== undefined && f[1] !== null && String(f[1]) !== ''; })
      .map(function (f) { return '<input type="hidden" name="' + f[0] + '" value="' + escapeHtml(String(f[1])) + '">'; })
      .join('')
    : '';

  openModal(id ? 'Editar Pendência' : 'Nova Pendência', `
    <form onsubmit="submitPendenciaForm(event,'${escapeHtml(id||'')}')">
      ${_tplField}
      ${_ocultos}
      <div class="form-row">
        <div class="form-group"><label class="form-label">Cliente</label>
          <select class="form-select" name="clientId">
            <option value="">Sem cliente</option>
            ${clients.map(c=>`<option value="${escapeHtml(c.id)}" ${((p.clientId||preClientId)===c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Tipo de Ação</label>
          <select class="form-select" name="tipo">
            ${_tiposVisiveis.map(t=>`<option ${p.tipo===t?'selected':''}>${escapeHtml(t)}</option>`).join('')}
          </select></div>
      </div>
      ${_slaOn ? `<div class="form-row">
        <div class="form-group"><label class="form-label" for="penSolicitante">Solicitante</label>
          <input class="form-input" id="penSolicitante" name="solicitante" maxlength="120" list="penSolicitanteList" autocomplete="off" placeholder="Quem pediu, no cliente" value="${escapeHtml(p.solicitante||'')}" />
          ${penSolicitanteDatalistHtml('penSolicitanteList', p.clientId || preClientId)}</div>
        <div class="form-group"><label class="form-label" for="penCanal">Canal</label>
          <select class="form-select" id="penCanal" name="canal">${penCanalOptionsHtml(p.canal || '')}</select></div>
      </div>` : ''}
      <div class="form-group"><label class="form-label">Assunto *</label>
        <input class="form-input" name="assunto" maxlength="120" placeholder="Título/resumo da pendência..." value="${escapeHtml(p.assunto||'')}" required /></div>
      <div class="form-group"><label class="form-label">Descrição da Pendência *</label>
        <textarea class="form-textarea" name="descricao" rows="4" placeholder="Descreva em detalhes o que precisa ser feito..." required>${escapeHtml(p.descricao||'')}</textarea><div id="templateSuggestion" class="template-suggestion" style="display:none"></div></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Responsável</label>
          <select class="form-select" name="responsible">
            ${opNames.length
              ? opNames.map(name => `<option value="${escapeHtml(name)}" ${currentResp===name?'selected':''}>${escapeHtml(name)}</option>`).join('')
              : `<option value="${escapeHtml(currentResp)}">${escapeHtml(currentResp)}</option>`
            }
          </select></div>
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-select" name="status">
            ${Object.entries(STATUS_PEN_MAP).map(([k,v])=>`<option value="${k}" ${(p.status||'aberto')===k?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Prioridade</label>
          <select class="form-select" name="priority">
            <option value="baixa"  ${p.priority==='baixa'?'selected':''}>Baixa</option>
            <option value="media"  ${(!p.priority||p.priority==='media')?'selected':''}>Média</option>
            <option value="alta"   ${p.priority==='alta'?'selected':''}>Alta</option>
            <option value="critica"${p.priority==='critica'?'selected':''}>Crítica</option>
          </select></div>
        <div class="form-group"><label class="form-label">Prazo Limite</label>
          <input type="date" class="form-input" name="deadline" value="${escapeHtml(_prazoVal)}" data-sla-auto="${_prazoAuto ? '1' : '0'}" /></div>
      </div>
      ${_slaOn ? '<p class="sla-hint" data-sla-hint></p>' : ''}
      <div class="form-row">
        ${_slaOn ? `<div class="form-group"><label class="form-label" for="penCategoria">Categoria</label>
          <select class="form-select" id="penCategoria" name="categoria">${penCategoriaOptionsHtml(p.categoria || '')}</select></div>` : ''}
        <div class="form-group"><label class="form-label">Recorrência</label>
          <select class="form-select" name="recurrence">
            ${RECURRENCE_OPTIONS.map(o => `<option value="${o.value}" ${(p.recurrence||'')===o.value?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Link Útil (opcional)</label>
          <input class="form-input" name="linkUtil" value="${escapeHtml(p.linkUtil||'')}" placeholder="https://..." /></div>
        <div class="form-group"><label class="form-label">Tags (separadas por vírgula)</label>
          <input class="form-input" name="tags" value="${escapeHtml((p.tags||[]).join(', '))}" placeholder="Ex: urgente, firewall, vpn" /></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salvar</button>
      </div>
    </form>`);
  setTimeout(function(){
    try {
      var _f = document.querySelector('#modalBody form');
      if (_f && typeof slaBindPrazoAuto === 'function') slaBindPrazoAuto(_f);
      if (_f && typeof slaBindSolicitante === 'function') slaBindSolicitante(_f, 'penSolicitanteList');
    } catch (_) {}
    var ta=document.querySelector('textarea[name="descricao"]');
    var sug=document.getElementById('templateSuggestion');
    if(!ta||!sug) return;
    ta.addEventListener('input', function(){
      var txt=ta.value||'';
      var tpls=typeof getProcedureTemplates==='function'?getProcedureTemplates():[];
      var best=suggestTemplateForDescription(txt, tpls);
      if(best){
        sug.style.display='block';
        sug.innerHTML="Usar modelo '"+escapeHtml(best.title)+"'? <button class=\"btn btn-sm btn-primary\" onclick=\"applyTemplateSuggestion('"+escapeHtml(best.id)+"')\">Aplicar</button>";
      } else { sug.style.display='none'; sug.innerHTML=''; }
    });
  }, 30);
}

// Passos de um procedimento → itens de checklist (puro, testável).
// Usa linhas numeradas/marcadas ("1.", "2)", "-", "•"); sem marcadores,
// cada linha não vazia vira um item. Máx. 30.
function templateStepsToChecklist(content) {
  const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const marked = lines.map(l => l.match(/^(?:\d+\s*[.)-]|[-*•▪☐□])\s*(.+)$/)).filter(Boolean).map(m => m[1].trim());
  return (marked.length ? marked : lines).filter(Boolean).slice(0, 30);
}

function applyPenTemplate(tplId) {
  const hint = document.getElementById('penTemplateHint');
  const hidden = document.getElementById('penTemplateChecklist');
  const form = hidden ? hidden.form : null;
  const tpl = tplId && typeof getProcedureTemplates === 'function' ? (getProcedureTemplates() || []).find(t => t.id === tplId) : null;
  if (!tpl || !form) {
    if (hidden) hidden.value = '';
    if (hint) { hint.hidden = true; hint.textContent = ''; }
    return;
  }
  const steps = templateStepsToChecklist(tpl.content);
  hidden.value = JSON.stringify(steps);
  // Só preenche o que está vazio: não apaga o que a pessoa já digitou.
  if (form.assunto && !form.assunto.value.trim()) form.assunto.value = String(tpl.title || '').slice(0, 120);
  if (form.descricao && !form.descricao.value.trim()) form.descricao.value = 'Seguir o procedimento "' + (tpl.title || '') + '" (checklist abaixo).';
  if (hint) {
    hint.hidden = false;
    hint.textContent = steps.length
      ? (typeof plural === 'function' ? plural(steps.length, 'passo vira', 'passos viram') : steps.length + ' passos viram') + ' checklist ao salvar.'
      : 'Este modelo não tem passos para o checklist.';
  }
}

function submitPendenciaForm(e, id) {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const g  = k => fd.get(k)||'';
    const assunto = g('assunto').trim();
    const descricao = g('descricao').trim();
    const linkUtil = g('linkUtil').trim();
    const clientId = g('clientId');
    const client   = clientId ? getClientById(clientId) : null;
    if (clientId && !client) {
      showToast('Cliente inválido.', 'error');
      return;
    }
    if (client && !isTeamAdmin() && (client.team || 'init') !== getCurrentTeam()) {
      showToast('Você não pode criar pendências para clientes de outra equipe.', 'error');
      return;
    }
    const tagsRaw = g('tags').split(',').map(function(t){return t.trim();}).filter(Boolean);
    const tipoVal = g('tipo');
    // Gestão: bloqueio no form (savePendencia também bloqueia + RLS no banco).
    try {
      var _isGestForm = (typeof isPendenciaGestao === 'function') ? isPendenciaGestao({ tipo: tipoVal }) : false;
      var _canGestForm = (typeof canViewGestao === 'function') ? canViewGestao() : true;
      if (_isGestForm && !_canGestForm) { showToast('Apenas Gestão (Felipe e Joarli) pode usar o tipo Gestão.', 'error'); return; }
    } catch (_) {}
    const data = {
      id: id||null, clientId, clientName: client?.name||'', tipo: tipoVal,
      assunto, descricao, responsible: g('responsible'), status: g('status'),
      priority: g('priority'), deadline: g('deadline'),
      linkUtil: safeUrl(linkUtil) !== '#' ? linkUtil : '',
      tags: tagsRaw,
      recurrence: g('recurrence'),
    };
    // Atendimento (056): só entra no registro quando o formulário tem o campo.
    ['solicitante', 'canal', 'categoria'].forEach(function (k) { if (fd.has(k)) data[k] = String(fd.get(k) || '').trim(); });
    // Campos da caixa de triagem (066), vindos como hidden: sem copiar aqui,
    // o chamado nasce sem endereço de resposta, sem o corpo do e-mail e sem
    // o thread id — e a próxima mensagem da conversa vira chamado novo.
    ['solicitanteEmail', 'emailThreadId', 'emailMessageId', 'emailCorpo'].forEach(function (k) {
      if (fd.has(k)) { const v = String(fd.get(k) || '').trim(); if (v) data[k] = v; }
    });
    // Criada a partir de um modelo: nasce com o checklist dos passos.
    if (!id && g('templateChecklist')) {
      try {
        const items = JSON.parse(g('templateChecklist'));
        if (Array.isArray(items) && items.length) data.checklist = items.map(t => ({ text: String(t), done: false }));
      } catch (_) {}
    }
    const errors = validatePendencia(data);
    if (errors.length) { showToast(errors[0], 'error'); return; }
    const isNew = !id;
    // Volta à aba Pendências do cliente quando a edição partiu dela (mesma
    // pendência): reabre a aba já com a linha atualizada. Criação e demais
    // fluxos seguem inalterados.
    let _backToClient = null;
    try {
      if (!isNew && id && typeof _clientPenOrigin !== 'undefined' && _clientPenOrigin
        && _clientPenOrigin.clientId && _clientPenOrigin.penId === id) {
        _backToClient = { clientId: _clientPenOrigin.clientId };
      }
    } catch (_) {}
    try { _clientPenReturn = null; _clientPenOrigin = null; } catch (_) {}
    savePendencia(data); // preenche data.id/data.createdAt/data.updatedAt no create
    closeModal();
    if (isNew) {
      // Criado cai na página 0: volta para ela e injeta otimista até convergir.
      _penPage = 0; _penLastSig = '';
      _optimisticPenUpsert(data, { isNew: true });
      renderPenView(true);
    } else {
      _optimisticPenUpsert(data);
      renderPenView(false);
    }
    updateBadges();
    // Veio da caixa de entradas de e-mail (066): fecha o ciclo só agora, com
    // o chamado já salvo — marcar na abertura do formulário perderia o e-mail
    // se a pessoa desistisse no meio. O id da entrada vem do hidden: sem ele
    // (formulário comum), a chamada é um no-op.
    if (isNew) {
      try { if (typeof emailTriagemMarcarAberta === 'function') emailTriagemMarcarAberta(data.id, String(fd.get('etrEntrada') || ''), data.clientId); }
      catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'pendencias:etr-marcar'); }
    }
    showToast(id?'Pendência atualizada!':'Pendência criada!', 'success');
    if (_backToClient) {
      try {
        if (typeof getClientById === 'function' && !getClientById(_backToClient.clientId)) _backToClient = null;
      } catch (_) { _backToClient = null; }
    }
    if (_backToClient) {
      try {
        if (typeof viewClient === 'function') viewClient(_backToClient.clientId);
        if (typeof switchClientTab === 'function') switchClientTab('pendencias', _backToClient.clientId);
      } catch (_) {}
    }
  } catch (err) { showToast('Erro ao salvar pendência: ' + err.message, 'error'); }
}

function duplicatePendencia(id) {
  const p = getPendenciaById(id);
  if (!p) return;
  const created = savePendencia({
    clientId: p.clientId,
    clientName: p.clientName,
    tipo: p.tipo,
    assunto: ((p.assunto || '').trim() || p.descricao || '') + ' (cópia)',
    descricao: p.descricao || '',
    responsible: p.responsible,
    status: 'aberto',
    priority: p.priority,
    deadline: p.deadline,
    linkUtil: p.linkUtil,
    tags: p.tags || [],
    team: p.team || 'init',
    recurrence: p.recurrence,
  });
  closeModal();
  // Cópia é um create: volta para a página 0 e injeta otimista até convergir.
  _penPage = 0; _penLastSig = '';
  if (created) _optimisticPenUpsert(created, { isNew: true });
  renderPenView(true);
  updateBadges();
  showToast('Pendência duplicada!', 'success');
}

function deletePendenciaConfirm(id) {
  var p = getPendenciaById(id);
  if (!p) return;
  confirmAction('Excluir esta pendência?', function() {
    var snapshot = JSON.parse(JSON.stringify(p));
    if (!deletePendencia(id)) {
      showToast('Não foi possível excluir esta pendência.', 'error');
      return;
    }
    _optimisticPenRemove(id); // some da lista na hora (anti-ghost até o delete convergir)
    renderPenView(false);
    updateBadges();
    showUndoToast('Pendência removida.', function() {
      savePendencia(snapshot); // storage preserva o id original (links/anexos intactos)
      _clearOptimisticPenRemove(id);
      _optimisticPenUpsert(snapshot, { isNew: true }); // reaparece na hora
      renderPenView(false);
      updateBadges();
      showToast('Pendência restaurada.', 'success');
    });
  });
}

// Compositor: alternar Resposta × Anotação interna (delegação, sem onclick).
if (typeof registerActions === 'function') {
  registerActions({
    penNoteVis: (_el, vis) => penNoteVis(vis),
  });
}
