// app-events.js — Event bus central para refresh automático pós-mutação
// =====================================================================
// Uso: emitDataChanged('pendencias'|'operadores'|'clientes'|'atendimentos', payload?)
//      onDataChanged('pendencias', cb) -> retorna unsubscribe()
//      offDataChanged('pendencias', cb)
// Mantém filtros/paginação/scroll da tela visível, sem location.reload().
// Debounce por entidade (350ms) + indicador sutil no header.

const _dataBus = new Map(); // entity -> Set<cb>
const _dataDebounce = new Map(); // entity -> {timer, pendingPayload}
const _DEBOUNCE_MS = 350;

function onDataChanged(entity, cb){
  if(!entity || typeof cb!=='function') return function(){};
  var key=String(entity).toLowerCase();
  if(!_dataBus.has(key)) _dataBus.set(key, new Set());
  _dataBus.get(key).add(cb);
  return function(){
    var s=_dataBus.get(key);
    if(s) s.delete(cb);
  };
}
function offDataChanged(entity, cb){
  var key=String(entity||'').toLowerCase();
  var s=_dataBus.get(key);
  if(s && cb) s.delete(cb);
}
function _showRefreshIndicator(entity){
  try{
    var btn=document.getElementById('refreshBtn') || document.querySelector('.theme-toggle-btn[onclick*="refreshPage"]') || document.getElementById('topbarActionBtn');
    // fallback: usa o próprio botão de refresh do header se existir
    var rBtn=document.querySelector('[onclick="refreshPage()"]') || document.getElementById('notifSettingsBtn')?.nextElementSibling;
    // cria um spinner sutil no canto do header
    var ind=document.getElementById('dataRefreshIndicator');
    if(!ind){
      ind=document.createElement('span');
      ind.id='dataRefreshIndicator';
      ind.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);opacity:0;transition:opacity .2s;margin-left:8px';
      ind.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg> atualizando...';
      var header=document.querySelector('.topbar-right');
      if(header) header.prepend(ind);
    }
    if(ind){
      ind.style.opacity='1';
      clearTimeout(ind._hideTimer);
      ind._hideTimer=setTimeout(function(){ ind.style.opacity='0'; }, 900);
    }
    // anima o botão de refresh se existir
    var rb=document.querySelector('.theme-toggle-btn[title*="Recarregar"]');
    if(rb){
      rb.style.transition='transform .3s';
      rb.style.transform='rotate(180deg)';
      setTimeout(function(){ rb.style.transform=''; }, 400);
    }
  }catch(_){}
}
function emitDataChanged(entity, payload){
  var key=String(entity||'').toLowerCase();
  if(!key) return;
  // debounce por entidade
  var prev=_dataDebounce.get(key);
  if(prev && prev.timer) clearTimeout(prev.timer);
  var debounced=function(){
    _dataDebounce.delete(key);
    _showRefreshIndicator(key);
    var cbs=_dataBus.get(key);
    if(!cbs || !cbs.size) return;
    // também notifica 'all' listeners
    var all=_dataBus.get('all');
    var toCall=new Set(cbs);
    if(all) all.forEach(function(cb){ toCall.add(cb); });
    toCall.forEach(function(cb){
      try{ cb(payload, key); }catch(e){ console.warn('onDataChanged cb erro', e); }
    });
  };
  var timer=setTimeout(debounced, _DEBOUNCE_MS);
  _dataDebounce.set(key, {timer: timer, pendingPayload: payload});
  // caso seja mutação crítica que muda permissões/sessão, sinaliza
  // quem escuta pode decidir reload total — por padrão não recarrega
}

// Helpers para preservar scroll da contentArea durante refetch
function preserveScrollAround(fn){
  try{
    var ca=document.getElementById('contentArea');
    var top=ca?ca.scrollTop:0;
    var res=fn();
    if(res && typeof res.then==='function'){
      return res.finally(function(){
        try{ if(ca) ca.scrollTop=top; }catch(_){}
      });
    }
    try{ if(ca) ca.scrollTop=top; }catch(_){}
    return res;
  }catch(e){ return fn(); }
}

// Expõe globalmente e para testes
if(typeof window!=='undefined'){
  window.emitDataChanged=emitDataChanged;
  window.onDataChanged=onDataChanged;
  window.offDataChanged=offDataChanged;
  window.preserveScrollAround=preserveScrollAround;
}
if(typeof module!=='undefined' && module.exports){
  module.exports={emitDataChanged, onDataChanged, offDataChanged, preserveScrollAround, _dataBus, _dataDebounce};
}
