// milvus-atendimentos.js — Relatório Atendimentos Milvus (listagem + exporta)
// =====================================================================
// Padrão enxuto: edge function única `milvus-atendimentos` (action list/export),
// frontend resolve token por cliente (clients.milvusClientToken) e chama a
// function — nunca o Milvus direto. Cache Map com TTL 5min, normalização HH:MM.

const MILVUS_ATEND_TTL_MS = 5 * 60 * 1000;
const MILVUS_ATEND_CACHE = new Map(); // queryKey -> {at, data}

function _milvusAtendCacheKey(filters){
  try{ return JSON.stringify(filters || {}); }catch(_){ return String(Date.now()); }
}
function _milvusAtendGetCache(key){
  var entry=MILVUS_ATEND_CACHE.get(key);
  if(!entry) return null;
  if(Date.now() - entry.at > MILVUS_ATEND_TTL_MS){ MILVUS_ATEND_CACHE.delete(key); return null; }
  return entry.data;
}
function _milvusAtendSetCache(key, data){
  MILVUS_ATEND_CACHE.set(key, {at: Date.now(), data: data});
  // cap 50 entradas
  if(MILVUS_ATEND_CACHE.size>50){
    var first=MILVUS_ATEND_CACHE.keys().next().value;
    MILVUS_ATEND_CACHE.delete(first);
  }
}
function _normalizeHHMM(v){
  if(v==null || v==='') return '00:00';
  var s=String(v).trim();
  // Milvus já entrega HH:MM, mas garante padding e valida (aceita H:M)
  var m=s.match(/^(\d{1,3}):(\d{1,2})/);
  if(m){
    var h=String(Math.max(0, parseInt(m[1],10))).padStart(2,'0');
    var mm=String(Math.max(0, parseInt(m[2],10))).padStart(2,'0');
    return h+':'+mm;
  }
  // se vier decimal ou inteiro de minutos
  var n=Number(s);
  if(Number.isFinite(n)){
    var hh=Math.floor(n/60); var mm2=String(Math.round(n%60)).padStart(2,'0');
    return String(hh).padStart(2,'0')+':'+mm2;
  }
  return s.slice(0,5);
}
function normalizeMilvusAtendimento(raw){
  if(!raw || typeof raw!=='object') return null;
  return {
    id: raw.id !=null ? Number(raw.id) : null,
    codigo: raw.codigo !=null ? String(raw.codigo) : '',
    assunto: String(raw.assunto ?? ''),
    nome_fantasia: String(raw.nome_fantasia ?? ''),
    nome: String(raw.nome ?? ''),
    sobrenome: String(raw.sobrenome ?? ''),
    tecnico: String(raw.tecnico ?? raw.nome_tecnico ?? ''),
    data_inicial: raw.data_inicial ? String(raw.data_inicial) : null,
    data_final: raw.data_final ? String(raw.data_final) : null,
    data_criacao: raw.data_criacao ? String(raw.data_criacao) : null,
    data_solucao: raw.data_solucao ? String(raw.data_solucao) : null,
    tipo_hora: String(raw.tipo_hora ?? ''),
    is_externo: !!raw.is_externo,
    is_comercial: !!raw.is_comercial,
    total_horas_atendimento: _normalizeHHMM(raw.total_horas_atendimento),
    horas_ticket: _normalizeHHMM(raw.horas_ticket),
    horas_operador: _normalizeHHMM(raw.horas_operador),
    horas_internas: _normalizeHHMM(raw.horas_internas),
    horas_externas: _normalizeHHMM(raw.horas_externas),
    descricao: raw.descricao ? String(raw.descricao) : '',
    contato: String(raw.contato ?? ''),
    mesa_trabalho: raw.mesa_trabalho || null,
    tipo_chamado: raw.tipo_chamado || null,
    categoria_primaria: raw.categoria_primaria || null,
    categoria_secundaria: raw.categoria_secundaria || null,
    status: raw.status || null,
    setor: raw.setor || null,
    motivo_pausa: raw.motivo_pausa || null
  };
}
function _atendOpView(){
  try{
    var session=typeof getSession==='function'?getSession():null;
    var ops=typeof getOperators==='function'?getOperators():[];
    var me=session?ops.find(function(o){return o.id===session.opId;}):null;
    if(me) return {team: session.team || me.team, isAdmin: session.isAdmin===true || me.isAdmin===true, active: me.active};
    return {team: session?session.team:'init', isAdmin: session?session.isAdmin===true:false, active:true};
  }catch(_){ return {team:'init', isAdmin:false, active:true};}
}
function canViewMilvusAtendimentos(operator, client){
  if(!operator || !client) return false;
  if(operator.active===false) return false;
  if(operator.isAdmin===true) return true;
  return (operator.team||'init') === (client.team||'init');
}

function _resolveAtendToken(clientId){
  if(!clientId) return '';
  try{
    var c=typeof getClientById==='function'?getClientById(clientId):null;
    if(c && c.milvusClientToken) return String(c.milvusClientToken).trim();
  }catch(_){}
  return '';
}
function _monthRangeISO(){
  var now=new Date();
  var y=now.getFullYear(), m=now.getMonth();
  var first=new Date(y,m,1);
  var last=new Date(y,m+1,0);
  function fmt(d){ return d.toISOString().slice(0,10); }
  return {start: fmt(first), end: fmt(last)};
}

// Fetch paginado — resolve token, chama edge, normaliza, cacheia
async function fetchMilvusAtendimentos(opts){
  opts=opts||{};
  var clientId=opts.clientId || '';
  var dataInicial=opts.dataInicial || '';
  var dataFinal=opts.dataFinal || '';
  // default mês atual se não vier
  if(!dataInicial || !dataFinal){
    var r=_monthRangeISO();
    if(!dataInicial) dataInicial=r.start;
    if(!dataFinal) dataFinal=r.end;
  }
  var page=Math.max(1, parseInt(opts.page,10)||1);
  var perPage=[50,100,200].includes(Number(opts.perPage)) ? Number(opts.perPage) : 50;
  if(perPage>1000) perPage=1000;
  var isDescending=opts.isDescending!==false;

  var token='';
  if(clientId){
    token=_resolveAtendToken(clientId);
    if(!token) throw new Error('Cliente sem token Milvus configurado.');
    var client=typeof getClientById==='function'?getClientById(clientId):null;
    if(!canViewMilvusAtendimentos(_atendOpView(), client)) throw new Error('Acesso negado a este cliente.');
  }

  var cacheKey=_milvusAtendCacheKey({clientId, dataInicial, dataFinal, tecnico:opts.tecnico, codigo:opts.codigo, nomeMesa:opts.nomeMesa, isExterno:opts.isExterno, isComercial:opts.isComercial, motivoPausa:opts.motivoPausa, page, perPage, isDescending});
  var cached=_milvusAtendGetCache(cacheKey);
  if(cached) return cached;

  if(typeof isSupabaseConnected!=='function' || !isSupabaseConnected() || typeof supabaseClient==='undefined' || !supabaseClient){
    throw new Error('Sem conexão com o servidor.');
  }

  var filtro_body={
    data_inicial: dataInicial,
    data_final: dataFinal
  };
  if(token) filtro_body.token=token;
  if(opts.codigo) filtro_body.codigo=String(opts.codigo);
  if(opts.tecnico) filtro_body.nome_tecnico=String(opts.tecnico);
  if(opts.nomeMesa) filtro_body.nome_mesa=String(opts.nomeMesa);
  if(typeof opts.isExterno==='boolean') filtro_body.is_externo=opts.isExterno;
  if(typeof opts.isComercial==='boolean') filtro_body.is_comercial=opts.isComercial;
  if(opts.motivoPausa) filtro_body.motivo_pausa=String(opts.motivoPausa);

  var payload={
    action: 'list',
    filtro_body: filtro_body,
    pagina: page,
    total_registros: perPage,
    is_descending: isDescending
  };

  var res=await supabaseClient.functions.invoke('milvus-atendimentos', {body: payload});
  if(res.error) throw new Error(res.error.message || 'Falha ao consultar atendimentos');
  var data=res.data;
  if(!data || !Array.isArray(data.lista)) throw new Error('Resposta inválida do servidor');

  var lista=(data.lista||[]).map(function(r){ return normalizeMilvusAtendimento(r); }).filter(Boolean);
  var out={
    lista: lista,
    meta: data.meta || null,
    resumo: data.resumo || null,
    paginate: (data.meta && data.meta.paginate) ? data.meta.paginate : null
  };
  _milvusAtendSetCache(cacheKey, out);
  return out;
}

// Export — chama edge action export, decodifica base64 e dispara download
async function exportMilvusAtendimentos(opts){
  opts=opts||{};
  var clientId=opts.clientId || '';
  var tipoArquivo=String(opts.tipoArquivo||opts.tipo_arquivo||'csv').toLowerCase();
  if(!['csv','xls','xlsx'].includes(tipoArquivo)) tipoArquivo='csv';
  if(tipoArquivo==='xlsx') tipoArquivo='xls';

  var dataInicial=opts.dataInicial || '';
  var dataFinal=opts.dataFinal || '';
  if(!dataInicial || !dataFinal){
    var r=_monthRangeISO();
    if(!dataInicial) dataInicial=r.start;
    if(!dataFinal) dataFinal=r.end;
  }

  var token='';
  if(clientId){
    token=_resolveAtendToken(clientId);
    if(!token) throw new Error('Cliente sem token Milvus configurado.');
    var client=typeof getClientById==='function'?getClientById(clientId):null;
    if(!canViewMilvusAtendimentos(_atendOpView(), client)) throw new Error('Acesso negado a este cliente.');
  }

  if(typeof isSupabaseConnected!=='function' || !isSupabaseConnected() || typeof supabaseClient==='undefined' || !supabaseClient){
    throw new Error('Sem conexão com o servidor.');
  }

  var filtro_body={
    data_inicial: dataInicial,
    data_final: dataFinal,
    tipo_arquivo: tipoArquivo
  };
  if(token) filtro_body.token=token;
  if(opts.codigo) filtro_body.codigo=String(opts.codigo);
  if(opts.tecnico) filtro_body.nome_tecnico=String(opts.tecnico);
  if(opts.nomeMesa) filtro_body.nome_mesa=String(opts.nomeMesa);
  if(typeof opts.isExterno==='boolean') filtro_body.is_externo=opts.isExterno;
  if(typeof opts.isComercial==='boolean') filtro_body.is_comercial=opts.isComercial;
  if(opts.motivoPausa) filtro_body.motivo_pausa=String(opts.motivoPausa);

  var payload={action:'export', filtro_body: filtro_body};

  var res=await supabaseClient.functions.invoke('milvus-atendimentos', {body: payload});
  if(res.error) throw new Error(res.error.message || 'Falha ao exportar');
  var data=res.data;
  if(!data || !data.base64) throw new Error('Resposta de exportação inválida');

  try{
    var contentType=data.contentType || (tipoArquivo==='xls' ? 'application/vnd.ms-excel' : 'text/csv');
    var binary=atob(data.base64);
    var len=binary.length;
    var bytes=new Uint8Array(len);
    for(var i=0;i<len;i++) bytes[i]=binary.charCodeAt(i);
    var blob=new Blob([bytes], {type: contentType});
    var ext=tipoArquivo==='xls'?'xls':'csv';
    var fname='relatorio-atendimentos-'+(dataInicial||'')+'_'+(dataFinal||'')+'.'+ext;
    // usa helper existente se houver
    if(typeof download==='function'){
      // download helper do projeto espera (filename, content, type) — tenta compatibilidade
      try{ download(fname, blob); }catch(_){ _triggerDownload(blob,fname); }
    } else {
      _triggerDownload(blob,fname);
    }
    if(typeof showToast==='function') showToast('Exportação gerada com sucesso!', 'success');
    return {success:true, file: fname};
  }catch(e){
    if(typeof showToast==='function') showToast('Falha ao processar arquivo exportado', 'error');
    throw e;
  }
}
function _triggerDownload(blob, filename){
  try{
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url; a.download=filename; a.style.display='none';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
  }catch(_){
    if(typeof showToast==='function') showToast('Falha ao disparar download', 'error');
  }
}

// ── UI: helpers visuais ───────────────────────────────────────────────────
function _atendStatusTag(st){
  if(!st) return '<span class="tag tag-gray">—</span>';
  var id = (st.id!=null ? st.id : st.text!=null ? st.text : st);
  var txt = st.text!=null ? String(st.text) : String(st);
  var t=(txt||'').toLowerCase();
  if(/finaliz|conclu|resolv/.test(t)) return '<span class="tag tag-green">'+escapeHtml(txt)+'</span>';
  if(/andamento|aberto|pendente|atend/.test(t)) return '<span class="tag tag-yellow">'+escapeHtml(txt)+'</span>';
  if(/paus/.test(t)) return '<span class="tag tag-gray">'+escapeHtml(txt)+'</span>';
  if(/cancel/.test(t)) return '<span class="tag tag-red">'+escapeHtml(txt)+'</span>';
  return '<span class="tag tag-blue">'+escapeHtml(txt)+'</span>';
}
function _atendFmtDate(dt){
  if(!dt) return '—';
  try{
    if(typeof formatDateTime==='function') return formatDateTime(dt);
    return new Date(String(dt).replace(' ', 'T')).toLocaleString('pt-BR');
  }catch(_){ return String(dt); }
}
function _atendFmtHora(h){ return _normalizeHHMM(h); }

// Estado UI (separado por contexto: global vs cliente)
var _atendUI = {clientId:'', dataInicial:'', dataFinal:'', codigo:'', tecnico:'', nomeMesa:'', isExterno:'', isComercial:'', motivoPausa:'', page:1, perPage:50, isDescending:true};
function _atendGetFilters(fromGlobal){
  var prefix = fromGlobal ? 'gAtend' : 'atend';
  var selClient = fromGlobal ? (document.getElementById('gAtendClient')?.value || _atendUI.clientId || '') : (_atendUI.clientId||'');
  return {
    clientId: selClient,
    dataInicial: document.getElementById(prefix+'DataInicial')?.value || _atendUI.dataInicial || '',
    dataFinal: document.getElementById(prefix+'DataFinal')?.value || _atendUI.dataFinal || '',
    codigo: document.getElementById(prefix+'Codigo')?.value || '',
    tecnico: document.getElementById(prefix+'Tecnico')?.value || '',
    nomeMesa: document.getElementById(prefix+'NomeMesa')?.value || '',
    isExterno: (function(){ var v=document.getElementById(prefix+'IsExterno')?.value; return v===''?'':v==='true'; })(),
    isComercial: (function(){ var v=document.getElementById(prefix+'IsComercial')?.value; return v===''?'':v==='true'; })(),
    motivoPausa: document.getElementById(prefix+'MotivoPausa')?.value || '',
    page: _atendUI.page||1,
    perPage: _atendUI.perPage||50,
    isDescending: _atendUI.isDescending!==false
  };
}
function _atendBuildResumoHtml(resumo){
  if(!resumo) return '';
  var items=[
    {label:'Chamados', value: resumo.total_chamados ?? resumo.totalChamados ?? '—', color:'var(--accent)'},
    {label:'Total Horas', value: _atendFmtHora(resumo.total_horas ?? resumo.totalHoras), color:'var(--green)'},
    {label:'Internas', value: _atendFmtHora(resumo.total_horas_internas ?? resumo.total_horas_internas), color:'#0ea5e9'},
    {label:'Externas', value: _atendFmtHora(resumo.total_horas_externas ?? resumo.total_horas_externas), color:'#7c3aed'},
    {label:'Expediente', value: _atendFmtHora(resumo.total_horas_expediente ?? resumo.total_horas_expediente), color:'var(--text-primary)'},
    {label:'Fora Exp.', value: _atendFmtHora(resumo.total_horas_fora_expediente ?? resumo.total_horas_fora_expediente), color:'#d97706'}
  ];
  return '<div class="stats-grid" style="margin-bottom:16px">'+items.map(function(it){
    return '<div class="stat-card" style="padding:14px 16px; gap:10px"><div><div class="stat-value" style="font-size:20px;color:'+it.color+'">'+escapeHtml(String(it.value))+'</div><div class="stat-label">'+escapeHtml(it.label)+'</div></div></div>';
  }).join('')+'</div>';
}
function _atendTableHtml(lista, hideCliente){
  if(!lista || !lista.length) return '<div class="empty-state" style="padding:24px"><p>Nenhum atendimento encontrado no período</p><p style="font-size:12px;color:var(--text-muted)">Ajuste os filtros ou tente outro período.</p></div>';
  return '<div class="table-wrapper"><table><thead><tr><th>Código</th><th>Assunto</th>'+(hideCliente?'':'<th>Cliente</th>')+'<th>Técnico</th><th>Data Inicial</th><th>Data Final</th><th style="text-align:right">Horas</th><th>Status</th></tr></thead><tbody>'+
    lista.map(function(r){
      var st=r.status || {text:r.status};
      return '<tr>'+
        '<td><strong>'+escapeHtml(String(r.codigo||'—'))+'</strong></td>'+
        '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escapeHtml(r.assunto||'')+'">'+escapeHtml(r.assunto||'—')+'</td>'+
        (hideCliente?'':'<td>'+escapeHtml(r.nome_fantasia|| r.nome||'—')+'</td>')+
        '<td>'+escapeHtml(r.tecnico||'—')+'</td>'+
        '<td>'+_atendFmtDate(r.data_inicial)+'</td>'+
        '<td>'+_atendFmtDate(r.data_final)+'</td>'+
        '<td style="text-align:right;font-variant-numeric:tabular-nums">'+escapeHtml(r.total_horas_atendimento||'00:00')+'</td>'+
        '<td>'+_atendStatusTag(st)+'</td>'+
      '</tr>';
    }).join('')+'</tbody></table></div>';
}
function _atendPagerHtml(paginate, perPage, currentPage, total){
  var meta=paginate || {};
  var last = Number(meta.last_page || meta.lastPage || 1) || 1;
  var from = meta.from || ((currentPage-1)*perPage+1);
  var to = meta.to || Math.min(currentPage*perPage, total||0);
  total = Number(meta.total || total || 0);
  if(!total) return '';
  var cur=currentPage;
  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border);margin-top:12px;flex-wrap:wrap;gap:8px">'+
    '<div style="font-size:12px;color:var(--text-muted)">Página '+cur+' de '+last+' · '+from+'–'+to+' de '+total+'</div>'+
    '<div style="display:flex;gap:6px;align-items:center">'+
      '<select class="form-select" style="width:90px;font-size:12px;padding:4px 8px" onchange="_atendChangePerPage(this.value)"><option value="50" '+(perPage==50?'selected':'')+'>50</option><option value="100" '+(perPage==100?'selected':'')+'>100</option><option value="200" '+(perPage==200?'selected':'')+'>200</option></select>'+
      '<button class="btn btn-sm btn-secondary" '+(cur<=1?'disabled':'')+' onclick="_atendGotoPage('+(cur-1)+')">‹ Anterior</button>'+
      '<span style="font-size:13px;padding:4px 8px">'+cur+' / '+last+'</span>'+
      '<button class="btn btn-sm btn-secondary" '+(cur>=last?'disabled':'')+' onclick="_atendGotoPage('+(cur+1)+')">Próxima ›</button>'+
    '</div>'+
  '</div>';
}
function _atendSkeleton(){
  return '<div class="stats-grid" style="margin-bottom:16px">'+Array(6).fill(0).map(function(){return '<div class="card" style="padding:16px"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>';}).join('')+'</div>'+
    '<div class="skeleton-row"><div class="skeleton skeleton-text" style="width:100%"></div></div>'.repeat(4);
}
function _atendToggleMore(prefix){
  var panel=document.getElementById(prefix+'MorePanel');
  var btn=document.getElementById(prefix+'MoreBtn');
  if(!panel||!btn) return;
  var open=panel.dataset.open==='1';
  panel.dataset.open=open?'0':'1';
  panel.style.display=open?'none':'flex';
  btn.setAttribute('aria-expanded', open?'false':'true');
}
if(typeof window!=='undefined' && !window._atendMoreBound){
  window._atendMoreBound=true;
  document.addEventListener('click', function(e){
    ['atend','gAtend'].forEach(function(p){
      var panel=document.getElementById(p+'MorePanel'); var btn=document.getElementById(p+'MoreBtn');
      if(!panel||!btn) return;
      if(panel.dataset.open!=='1') return;
      if(panel.contains(e.target)||btn.contains(e.target)) return;
      panel.dataset.open='0'; panel.style.display='none'; btn.setAttribute('aria-expanded','false');
    });
  });
}
function _atendDoFetchAndRender(isGlobal){
  var prefix=isGlobal?'gAtend':'atend';
  var filtros=_atendGetFilters(isGlobal);
  // normaliza vazios para boolean undefined
  if(filtros.isExterno==='') delete filtros.isExterno;
  if(filtros.isComercial==='') delete filtros.isComercial;
  // valida datas
  var listEl=document.getElementById(prefix+'List');
  var resumoEl=document.getElementById(prefix+'Resumo');
  if(listEl) listEl.innerHTML='<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Carregando…</p>';
  if(resumoEl) resumoEl.innerHTML=_atendSkeleton();
  var pageBtn=document.getElementById(prefix+'PageInfo');
  // sincroniza seletor global antes do fetch
  if(isGlobal){
    var sel=document.getElementById('gAtendClient');
    if(sel) _atendUI.clientId=sel.value||'';
  }
  // chama fetch
  var opts={
    clientId: filtros.clientId || _atendUI.clientId || '',
    dataInicial: filtros.dataInicial,
    dataFinal: filtros.dataFinal,
    codigo: filtros.codigo,
    tecnico: filtros.tecnico,
    nomeMesa: filtros.nomeMesa,
    isExterno: typeof filtros.isExterno==='boolean'?filtros.isExterno:undefined,
    isComercial: typeof filtros.isComercial==='boolean'?filtros.isComercial:undefined,
    motivoPausa: filtros.motivoPausa,
    page: filtros.page,
    perPage: _atendUI.perPage||50,
    isDescending: filtros.isDescending
  };
  fetchMilvusAtendimentos(opts).then(function(data){
    var hideCliente=!isGlobal;
    if(resumoEl) resumoEl.innerHTML=_atendBuildResumoHtml(data.resumo);
    if(listEl){
      listEl.innerHTML=_atendTableHtml(data.lista, hideCliente) + _atendPagerHtml(data.paginate||data.meta?.paginate, _atendUI.perPage||50, _atendUI.page||1, data.paginate?.total || data.meta?.paginate?.total || data.lista.length);
    }
  }).catch(function(e){
    var msg=(e && e.message) ? e.message : 'Falha ao consultar';
    if(resumoEl) resumoEl.innerHTML='';
    if(listEl) listEl.innerHTML='<div class="empty-state" style="padding:24px"><p style="color:var(--red)">'+escapeHtml(msg)+'</p><p style="font-size:12px;color:var(--text-muted)">Verifique o token do cliente e o período.</p></div>';
    if(typeof showToast==='function') showToast(msg,'error');
  });
}
function _atendChangePerPage(val){
  _atendUI.perPage=Number(val)||50;
  _atendUI.page=1;
  var isGlobal=document.getElementById('gAtendList')!=null;
  _atendDoFetchAndRender(isGlobal);
}
function _atendGotoPage(p){
  _atendUI.page=Math.max(1, Number(p)||1);
  var isGlobal=document.getElementById('gAtendList')!=null;
  _atendDoFetchAndRender(isGlobal);
}
function _atendApplyFilters(isGlobal){
  _atendUI.page=1;
  _atendDoFetchAndRender(isGlobal);
}
function _atendExport(tipo){
  var isGlobal=document.getElementById('gAtendList')!=null;
  if(isGlobal){ var sel=document.getElementById('gAtendClient'); if(sel) _atendUI.clientId=sel.value||''; }
  var f=_atendGetFilters(isGlobal);
  var opts={
    clientId: f.clientId || _atendUI.clientId || '',
    dataInicial: f.dataInicial,
    dataFinal: f.dataFinal,
    codigo: f.codigo,
    tecnico: f.tecnico,
    nomeMesa: f.nomeMesa,
    isExterno: typeof f.isExterno==='boolean'?f.isExterno:undefined,
    isComercial: typeof f.isComercial==='boolean'?f.isComercial:undefined,
    motivoPausa: f.motivoPausa,
    tipoArquivo: tipo
  };
  if(typeof showToast==='function') showToast('Gerando exportação...','info');
  exportMilvusAtendimentos(opts).catch(function(e){
    var msg=(e && e.message)||'Falha ao exportar';
    if(typeof showToast==='function') showToast(msg,'error');
  });
}
function _atendToggleExport(){
  var m=document.getElementById('atendExportMenu');
  if(!m) return;
  var open=m.dataset.open==='1';
  m.dataset.open=open?'0':'1';
  m.style.display=open?'none':'block';
}
if(typeof window!=='undefined'){
  document.addEventListener('click', function(e){
    var m=document.getElementById('atendExportMenu'); var b=document.getElementById('atendExportBtn');
    if(!m||!b) return;
    if(m.dataset.open!=='1') return;
    if(m.contains(e.target)||b.contains(e.target)) return;
    m.dataset.open='0'; m.style.display='none';
  });
}

// Render aba cliente (chamada por clients.js)
function renderMilvusAtendimentosTab(clientId){
  var el=document.getElementById('clientTabContent');
  if(!el) return;
  _atendUI.clientId=clientId;
  _atendUI.page=1;
  var range=_monthRangeISO();
  el.innerHTML=
    '<div id="atendResumo">'+_atendSkeleton()+'</div>'+
    '<div class="search-bar" style="flex-wrap:wrap;gap:8px;align-items:center">'+
      '<input type="date" class="form-input" id="atendDataInicial" value="'+range.start+'" style="width:150px" />'+
      '<span style="font-size:12px;color:var(--text-muted)">até</span>'+
      '<input type="date" class="form-input" id="atendDataFinal" value="'+range.end+'" style="width:150px" />'+
      '<div class="search-input-wrap" style="flex:1;min-width:140px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="form-input" id="atendCodigo" placeholder="Código ticket" oninput="if(this.value===\'\') _atendApplyFilters(false)" /></div>'+
      '<button class="btn btn-primary btn-sm" onclick="_atendApplyFilters(false)">Buscar</button>'+
      '<button class="btn btn-secondary btn-sm" id="atendMoreBtn" onclick="_atendToggleMore(\'atend\')" aria-expanded="false">Mais filtros</button>'+
      '<div style="position:relative">'+
        '<button class="btn btn-primary btn-sm" id="atendExportBtn" onclick="_atendToggleExport()">Exportar ▾</button>'+
        '<div id="atendExportMenu" data-open="0" style="display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:120px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px">'+
          '<button class="op-kebab-item" onclick="_atendToggleExport();_atendExport(\'csv\')">CSV</button>'+
          '<button class="op-kebab-item" onclick="_atendToggleExport();_atendExport(\'xls\')">XLS</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div id="atendMorePanel" data-open="0" style="display:none;flex-wrap:wrap;gap:8px;padding:10px;background:var(--bg-base);border:1px solid var(--border);border-radius:8px;margin-bottom:12px">'+
      '<input class="form-input" id="atendTecnico" placeholder="Técnico" style="width:160px" />'+
      '<input class="form-input" id="atendNomeMesa" placeholder="Mesa" style="width:140px" />'+
      '<select class="form-select" id="atendIsExterno" style="width:130px"><option value="">Externo?</option><option value="true">Sim</option><option value="false">Não</option></select>'+
      '<select class="form-select" id="atendIsComercial" style="width:130px"><option value="">Comercial?</option><option value="true">Sim</option><option value="false">Não</option></select>'+
      '<input class="form-input" id="atendMotivoPausa" placeholder="Motivo pausa" style="width:150px" />'+
    '</div>'+
    '<div id="atendList"></div>';
  _atendDoFetchAndRender(false);
}

// Render página global Relatórios (chamada por app.js navigateTo) — só time init
function renderRelatorios(){
  try {
    var _team = typeof getCurrentTeam==='function' ? String(getCurrentTeam()||'').toLowerCase().trim() : String((typeof getSession==='function'&&getSession()?.team)||'init').toLowerCase().trim();
    if (_team !== 'init') {
      document.getElementById('pageTitle').textContent='Relatórios';
      document.getElementById('contentArea').innerHTML='<div class="empty-state" style="padding:40px"><p>Acesso restrito ao time Init.</p></div>';
      if (typeof showToast==='function') showToast('Relatórios disponível apenas para o time Init.', 'error');
      return;
    }
  } catch(_){}
  document.getElementById('pageTitle').textContent='Relatórios — Atendimentos';
  var content=document.getElementById('contentArea');
  var range=_monthRangeISO();
  _atendUI.clientId='';
  _atendUI.page=1;
  var clients=typeof getMyClients==='function'?getMyClients(): (typeof getClients==='function'?getClients():[]);
  content.innerHTML=
    '<div class="search-bar" style="flex-wrap:wrap;gap:8px;align-items:center">'+
      '<select class="form-select" id="gAtendClient" style="width:200px" onchange="_atendUI.clientId=this.value;_atendApplyFilters(true)"><option value="">Todos clientes (sem token)</option>'+clients.map(function(c){return '<option value="'+escapeHtml(c.id)+'">'+escapeHtml(c.name)+'</option>';}).join('')+'</select>'+
      '<input type="date" class="form-input" id="gAtendDataInicial" value="'+range.start+'" style="width:150px" />'+
      '<span style="font-size:12px;color:var(--text-muted)">até</span>'+
      '<input type="date" class="form-input" id="gAtendDataFinal" value="'+range.end+'" style="width:150px" />'+
      '<div class="search-input-wrap" style="flex:1;min-width:140px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input class="form-input" id="gAtendCodigo" placeholder="Código ticket" /></div>'+
      '<button class="btn btn-primary btn-sm" onclick="_atendApplyFilters(true)">Buscar</button>'+
      '<button class="btn btn-secondary btn-sm" id="gAtendMoreBtn" onclick="_atendToggleMore(\'gAtend\')" aria-expanded="false">Mais filtros</button>'+
      '<div style="position:relative"><button class="btn btn-primary btn-sm" id="atendExportBtn" onclick="_atendToggleExport()">Exportar ▾</button><div id="atendExportMenu" data-open="0" style="display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:20;min-width:120px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px"><button class="op-kebab-item" onclick="_atendToggleExport();_atendExport(\'csv\')">CSV</button><button class="op-kebab-item" onclick="_atendToggleExport();_atendExport(\'xls\')">XLS</button></div></div>'+
    '</div>'+
    '<div id="gAtendMorePanel" data-open="0" style="display:none;flex-wrap:wrap;gap:8px;padding:10px;background:var(--bg-base);border:1px solid var(--border);border-radius:8px;margin-bottom:12px">'+
      '<input class="form-input" id="gAtendTecnico" placeholder="Técnico" style="width:160px" />'+
      '<input class="form-input" id="gAtendNomeMesa" placeholder="Mesa" style="width:140px" />'+
      '<select class="form-select" id="gAtendIsExterno" style="width:130px"><option value="">Externo?</option><option value="true">Sim</option><option value="false">Não</option></select>'+
      '<select class="form-select" id="gAtendIsComercial" style="width:130px"><option value="">Comercial?</option><option value="true">Sim</option><option value="false">Não</option></select>'+
      '<input class="form-input" id="gAtendMotivoPausa" placeholder="Motivo pausa" style="width:150px" />'+
    '</div>'+
    '<div id="gAtendResumo">'+_atendSkeleton()+'</div>'+
    '<div id="gAtendList"></div>';
  _atendDoFetchAndRender(true);
}

// ── Auto-refresh global ──
(function(){
  if(typeof window==='undefined' || typeof onDataChanged!=='function') return;
  if(window._atendAutoRefresh) return;
  window._atendAutoRefresh=true;
  onDataChanged('atendimentos', function(){
    var h=(window.location.hash.replace('#','')||'dashboard');
    // global Relatórios
    if(h==='relatorios'){
      try{ preserveScrollAround(function(){ _atendDoFetchAndRender(true); }); }catch(_){}
      return;
    }
    // aba cliente Atendimentos dentro do modal
    try{
      var tab=document.querySelector('#clientTabs .tab.active');
      if(tab && tab.textContent.trim().toLowerCase().indexOf('atendimento')!==-1 && document.getElementById('atendList')){
        preserveScrollAround(function(){ _atendDoFetchAndRender(false); });
      }
    }catch(_){}
  });
})();

// Helpers puros para testes/UI
function _clearMilvusAtendCache(){ MILVUS_ATEND_CACHE.clear(); }

if(typeof module!=='undefined' && module.exports){
  module.exports={
    MILVUS_ATEND_TTL_MS,
    normalizeMilvusAtendimento,
    canViewMilvusAtendimentos,
    fetchMilvusAtendimentos,
    exportMilvusAtendimentos,
    _clearMilvusAtendCache,
    _normalizeHHMM,
    _monthRangeISO
  };
}
