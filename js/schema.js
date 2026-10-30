// schema.js — Fonte única de verdade das entidades (sync + realtime)
// =============================================================================
// Um único registro declarativo por entidade do Supabase. A partir dele são
// derivados: o mapa de campos (remote -> local) para o sync bidirecional, o
// mapeamento/coerção do Realtime, o filtro por equipe e o refresh da UI.
// Carregado ANTES de supabase-config.js e storage.js.
// =============================================================================

const ENTITIES = [
  {
    table: 'clients',
    dbKey: 'intra_clients',
    label: 'Clientes',
    hasTeam: true,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', name: 'name', cnpj: 'cnpj', segment: 'segment', color: 'color',
      initials: 'initials', logo: 'logo', logo_shape: 'logoShape', owner: 'owner',
      owner_phone: 'ownerPhone', responsible: 'responsible', responsible_phone: 'responsiblePhone',
      technician: 'technician', server: 'server', hosting: 'hosting', backup: 'backup',
      licenses: 'licenses', emails: 'emails', google_sheet_url: 'googleSheetUrl', drive_folder_url: 'driveFolderUrl', milvus_client_token: 'milvusClientToken', team: 'team',
      notes: 'notes', attachments: 'attachments', documents: 'documents', created_at: 'createdAt', updated_by: 'updatedBy', updated_at: 'updatedAt',
      address: 'address'
    },
    // Colunas novas (migration 044+): só vão no upsert quando têm valor —
    // banco ainda sem a coluna não derruba o sync de todos os clientes.
    optionalFields: ['address', 'drive_folder_url'],
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'clientes' && document.getElementById('clientGrid') && typeof renderClientGrid === 'function') renderClientGrid();
    }
  },
  {
    table: 'pendencias',
    dbKey: 'intra_pendencias',
    label: 'Pendências',
    hasTeam: true,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', client_id: 'clientId', client_name: 'clientName', tipo: 'tipo', assunto: 'assunto', descricao: 'descricao',
      responsible: 'responsible', status: 'status', priority: 'priority', deadline: 'deadline',
      notes: 'notes', link_util: 'linkUtil', team: 'team', attachments: 'attachments',
      checklist: 'checklist', tags: 'tags', recurrence: 'recurrence', visit_id: 'visitId',
      reviewed_in_meeting: 'reviewedInMeeting',
      timer_running: 'timerRunning', timer_started_at: 'timerStartedAt', timer_total_seconds: 'timerTotalSeconds',
      timer_operator: 'timerOperator', completed_at: 'completedAt', completed_by: 'completedBy', created_at: 'createdAt', updated_at: 'updatedAt',
      responsible_id: 'responsibleId', timer_operator_id: 'timerOperatorId',
      solicitante: 'solicitante', canal: 'canal', categoria: 'categoria',
      first_response_due: 'firstResponseDue', first_response_at: 'firstResponseAt', first_response_by: 'firstResponseBy',
      position: 'position', events: 'events',
      solicitante_email: 'solicitanteEmail', email_message_id: 'emailMessageId',
      email_thread_id: 'emailThreadId', email_corpo: 'emailCorpo'
    },
    // ids de pessoa (049): o banco deriva do nome; só vão no upsert se houver valor.
    // Atendimento e SLA (056): idem, para o app seguir funcionando antes da migration.
    // Ordem manual do quadro (062): idem — sem a coluna, o app ignora e ordena
    // por criação/prazo/prioridade como antes.
    // Linha do tempo (063): idem — sem a coluna os eventos ficam só no
    // aparelho (não viajam nem sobrevivem a um pull).
    // Conversa casada (065): idem — sem a coluna a triagem volta a abrir um
    // chamado por mensagem, em vez de postar a resposta no que já existe.
    // Resposta por e-mail (064): idem — sem as colunas o chamado continua
    // aberto pela triagem, só não dá para responder ao cliente pela tela.
    // E-mail inteiro (066): idem — sem a coluna o chamado mostra só a
    // descrição de 600 caracteres, como antes.
    optionalFields: ['responsible_id', 'timer_operator_id', 'solicitante', 'canal', 'categoria',
      'first_response_due', 'first_response_at', 'first_response_by', 'position', 'events',
      'solicitante_email', 'email_message_id', 'email_thread_id', 'email_corpo'],
    onChange: () => {
      if (typeof updateBadges === 'function') updateBadges();
      if ((window.location.hash.replace('#', '') || '') === 'pendencias' && document.getElementById('penViewArea') && typeof renderPenView === 'function') renderPenView(false);
      // Cross-tela: realtime de pendência com dashboard aberto atualiza os
      // números ( throttle de bursts: no máximo 1 refresh a cada ~1.2s ).
      try {
        if ((window.location.hash.replace('#', '') || '') === 'dashboard' && typeof renderDashboard === 'function' && document.getElementById('contentArea')) {
          if (!window._dashRTRefreshTimer) {
            window._dashRTRefreshTimer = setTimeout(function() {
              window._dashRTRefreshTimer = null;
              try {
                if ((window.location.hash.replace('#', '') || '') !== 'dashboard') return;
                if (typeof preserveScrollAround === 'function') preserveScrollAround(function() { renderDashboard(); });
                else renderDashboard();
              } catch (_) {}
            }, 1200);
          }
        }
      } catch (_) {}
    }
  },
  {
    table: 'operators',
    dbKey: 'intra_operators',
    label: 'Operadores',
    hasTeam: false,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', name: 'name', initials: 'initials', color: 'color', role: 'role', phone: 'phone',
      email: 'email', is_admin: 'isAdmin', is_gestao: 'isGestao', active: 'active', team: 'team', auth_user_id: 'auth_user_id',
      on_leave: 'onLeave',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    // Hash de senha não existe mais no app (a senha é do Supabase Auth):
    // o merge apaga qualquer pinHash/pinSalt que tenha ficado no aparelho.
    onMerged: (merged) => {
      for (const o of merged) { delete o.pinHash; delete o.pinSalt; }
      return merged;
    },
    buildUpsert: o => ({
      id: o.id, name: o.name, initials: o.initials, color: o.color, role: o.role, phone: o.phone,
      email: o.email,
      is_admin: o.isAdmin === true, is_gestao: o.isGestao === true, active: o.active !== false, team: o.team || 'init',
      auth_user_id: o.auth_user_id || null, on_leave: o.onLeave === true,
      created_at: o.createdAt || new Date().toISOString(), updated_at: o.updatedAt || new Date().toISOString()
    }),
    mapRow: r => ({
      id: r.id, name: r.name, initials: r.initials, color: r.color, role: r.role, phone: r.phone,
      email: r.email, isAdmin: r.is_admin === true, isGestao: r.is_gestao === true, active: r.active !== false, team: r.team || 'init',
      auth_user_id: r.auth_user_id, onLeave: r.on_leave === true, createdAt: r.created_at, updatedAt: r.updated_at
    }),
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'operadores' && document.getElementById('opGridWrap') && typeof filterOperadores === 'function') filterOperadores();
    }
  },
  {
    table: 'procedures',
    dbKey: 'intra_procedures',
    label: 'Procedimentos',
    hasTeam: false,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', client_id: 'clientId', title: 'title', category: 'category', content: 'content',
      created_at: 'createdAt', updated_at: 'updatedAt',
      team: 'team' // artigos da base de conhecimento (sem cliente) — migration 042
    },
    optionalFields: ['team'],
    onChange: () => {}
  },
  {
    table: 'visits',
    dbKey: 'intra_visits',
    label: 'Visitas',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true,
    optionalFields: ['operator_id', 'assinatura', 'assinatura_nome', 'assinatura_em', 'levar', 'checkin_at', 'checkout_at'], // 049, 054, 058, 060
    fields: {
      id: 'id', client_id: 'clientId', client_name: 'clientName', operator: 'operator', date: 'date',
      time: 'time', time_end: 'timeEnd', all_day: 'allDay', motivo: 'motivo', observacoes: 'observacoes',
      relatorio: 'relatorio', status: 'status', recurrence: 'recurrence', team: 'team',
      categories: 'categories', checklist: 'checklist', numero: 'numero',
      milvus_chamado_codigo: 'milvusChamadoCodigo', milvus_chamado_status: 'milvusChamadoStatus',
      milvus_chamado_erro: 'milvusChamadoErro', milvus_chamado_tentativas: 'milvusChamadoTentativas',
      milvus_finalizar_status: 'milvusFinalizarStatus', milvus_finalizar_erro: 'milvusFinalizarErro',
      milvus_finalizar_tentativas: 'milvusFinalizarTentativas',
      operator_id: 'operatorId',
      assinatura: 'assinatura', assinatura_nome: 'assinaturaNome', assinatura_em: 'assinaturaEm',
      levar: 'levar', checkin_at: 'checkinAt', checkout_at: 'checkoutAt',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    mapRow: r => ({
      id: r.id, clientId: r.client_id, clientName: r.client_name, operator: r.operator, date: r.date,
      time: r.time, motivo: r.motivo, observacoes: r.observacoes, relatorio: r.relatorio, status: r.status,
      recurrence: r.recurrence, team: r.team, timeEnd: r.time_end, allDay: r.all_day === true,
      categories: r.categories || [], checklist: r.checklist || [],
      numero: (Number.isInteger(r.numero) && r.numero > 0) ? r.numero : null,
      milvusChamadoCodigo: r.milvus_chamado_codigo ?? null,
      milvusChamadoStatus: r.milvus_chamado_status ?? null,
      milvusChamadoErro: r.milvus_chamado_erro ?? null,
      milvusChamadoTentativas: r.milvus_chamado_tentativas ?? 0,
      milvusFinalizarStatus: r.milvus_finalizar_status ?? null,
      milvusFinalizarErro: r.milvus_finalizar_erro ?? null,
      milvusFinalizarTentativas: r.milvus_finalizar_tentativas ?? 0,
      operatorId: r.operator_id ?? null,
      assinatura: r.assinatura ?? null, assinaturaNome: r.assinatura_nome ?? null, assinaturaEm: r.assinatura_em ?? null,
      levar: Array.isArray(r.levar) ? r.levar : null,
      checkinAt: r.checkin_at ?? null, checkoutAt: r.checkout_at ?? null,
      // Só leitura: quem grava é o robô (fora de `fields`, o app nunca reenvia).
      briefingIa: r.briefing_ia ?? null, briefingEm: r.briefing_em ?? null,
      createdAt: r.created_at, updatedAt: r.updated_at
    }),
    // Estabilidade do número amigável: remoto SEM numero (coluna ainda sem
    // migration, cliente antigo, edição externa) nunca apaga o numero local.
    // Remoto COM número (reparo de outro aparelho, mais novo) entra pelo
    // merge normal — aqui só se restaura o local quando o merge zerou.
    onMerged: (merged, local) => {
      const localById = new Map((local || []).map(o => [o.id, o]));
      for (const m of (merged || [])) {
        if (!m || (m.numero !== null && m.numero !== undefined)) continue;
        const loc = m.id ? localById.get(m.id) : null;
        const n = loc ? Number(loc.numero) : NaN;
        if (Number.isInteger(n) && n > 0) m.numero = n;
      }
      return merged;
    },
    onChange: () => {
      const h = window.location.hash.replace('#', '') || '';
      if (h === 'visitas' && document.getElementById('visitViewArea') && typeof renderVisitView === 'function') renderVisitView();
      if (h === 'calendario' && typeof refreshCalendar === 'function') refreshCalendar();
    }
  },
  {
    table: 'reunioes',
    dbKey: 'intra_reunioes',
    label: 'Reuniões',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true,
    fields: {
      id: 'id', mes_ano: 'mesAno', status: 'status', started_at: 'startedAt', ended_at: 'endedAt',
      team: 'team', relatorio: 'relatorio', participants: 'participants',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    mapRow: r => ({
      id: r.id, mesAno: r.mes_ano, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
      team: r.team, relatorio: r.relatorio, participants: r.participants || [],
      createdAt: r.created_at, updatedAt: r.updated_at
    }),
    onChange: () => {
      const h = window.location.hash.replace('#', '') || '';
      if (h === 'reuniao' && document.getElementById('reuniaoViewArea') && typeof renderReuniaoView === 'function') renderReuniaoView();
    }
  },
  {
    table: 'equipamentos',
    dbKey: 'intra_equipamentos',
    label: 'Equipamentos',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true,
    fields: {
      id: 'id', nome: 'nome', numero_serie: 'numeroSerie', tipo: 'tipo',
      client_id: 'clientId', client_name: 'clientName', os_vinculada: 'osVinculada',
      pendencia_id: 'pendenciaId',
      status: 'status', valor: 'valor', data_aquisicao: 'dataAquisicao',
      observacoes: 'observacoes', team: 'team',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {
      const h = window.location.hash.replace('#', '') || '';
      if (h === 'equipamentos' && document.getElementById('equipViewArea') && typeof renderEquipView === 'function') renderEquipView(false);
      if (typeof updateBadges === 'function') updateBadges();
    }
  },
  {
    table: 'vencimentos',
    dbKey: 'intra_vencimentos',
    label: 'Vencimentos',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true, // migration 045: banco sem a tabela não quebra o sync
    optionalFields: ['responsavel_id'], // 049
    fields: {
      id: 'id', client_id: 'clientId', client_name: 'clientName', tipo: 'tipo',
      descricao: 'descricao', data_vencimento: 'dataVencimento', responsavel: 'responsavel',
      renovacao_auto: 'renovacaoAuto', status: 'status', observacoes: 'observacoes',
      avisos: 'avisos', historico: 'historico', team: 'team', responsavel_id: 'responsavelId',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {
      const h = window.location.hash.replace('#', '') || '';
      if (h === 'vencimentos' && typeof renderVencimentos === 'function' && document.getElementById('vencList')) renderVencimentos();
      if (typeof updateBadges === 'function') updateBadges();
    }
  },
  {
    table: 'time_entries',
    dbKey: 'intra_time_entries',
    label: 'Horas',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true, // migration 048
    fields: {
      id: 'id', pendencia_id: 'pendenciaId', client_id: 'clientId', operator_id: 'operatorId',
      operator_name: 'operatorName', started_at: 'startedAt', ended_at: 'endedAt', seconds: 'seconds',
      source: 'source', note: 'note', team: 'team', created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {}
  },
  {
    table: 'procedure_templates',
    dbKey: 'intra_procedure_templates',
    label: 'Modelos',
    hasTeam: false,
    sync: true,
    realtime: true,
    fields: {
      id: 'id', title: 'title', category: 'category', content: 'content', created_by: 'createdBy',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'templates' && document.getElementById('templatesGridWrap') && typeof renderTemplatesGrid === 'function') renderTemplatesGrid();
    }
  },
  {
    table: 'emails_triagem',
    dbKey: 'intra_emails_triagem',
    label: 'Entradas de e-mail',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true, // migration 066: banco sem a tabela não quebra o sync
    fields: {
      id: 'id', email_id: 'emailId', thread_id: 'threadId', message_id: 'messageId',
      de: 'de', assunto: 'assunto', corpo: 'corpo', recebido_em: 'recebidoEm',
      motivo: 'motivo', status: 'status', pendencia_id: 'pendenciaId', team: 'team',
      tratado_por: 'tratadoPor', tratado_em: 'tratadoEm',
      client_id: 'clientId', atribuido_a: 'atribuidoA', atribuido_em: 'atribuidoEm', atribuicao_nota: 'atribuicaoNota',
      canal: 'canal', telefone: 'telefone',
      created_at: 'createdAt', updated_at: 'updatedAt'
    },
    // 075: banco que ainda não rodou a migration não tem as colunas do WhatsApp;
    // a entrada sem canal continua sendo lida como e-mail.
    optionalFields: ['canal', 'telefone'], // 075
    onChange: () => {
      // A caixa mora na tela de Pendências: e-mail que chega enquanto alguém
      // está olhando aparece sozinho, que é o ponto de ela existir.
      if ((window.location.hash.replace('#', '') || '') === 'pendencias'
        && document.getElementById('penViewArea') && typeof renderEntradasEmail === 'function') renderEntradasEmail();
      // A tela #caixa também precisa ver a linha nova sem recarregar.
      if ((window.location.hash.replace('#', '') || '') === 'caixa'
        && document.getElementById('caixaLista') && typeof renderCaixaEntrada === 'function') renderCaixaEntrada();
    }
  },
  {
    table: 'respostas_prontas',
    dbKey: 'intra_respostas_prontas',
    label: 'Respostas prontas',
    hasTeam: true,
    sync: true,
    realtime: true,
    optional: true, // migration 074: banco sem a tabela não quebra o sync
    fields: {
      id: 'id', titulo: 'titulo', conteudo: 'conteudo', team: 'team',
      created_by: 'createdBy', created_at: 'createdAt', updated_at: 'updatedAt'
    }
  },
  {
    table: 'audit_logs',
    dbKey: 'intra_logs',
    label: 'Logs',
    hasTeam: false,
    sync: false,
    realtime: true,
    cacheTable: 'audit_logs',
    mapRow: r => ({
      id: r.id, operatorName: r.operator_name, action: r.action, type: r.type,
      targetId: r.target_id, details: r.details, timestamp: r.timestamp
    }),
    onChange: () => {
      if ((window.location.hash.replace('#', '') || '') === 'historico' && typeof renderLogs === 'function') renderLogs();
    }
  }
];

// Entidades que participam do sync bidirecional (na ordem de processamento)
const SYNC_ENTITIES = ENTITIES.filter(e => e.sync !== false);

// Concorrência do sync entre entidades (tabelas distintas, independentes).
// 3 = ~3× mais rápido no boot sem pressionar o pool do PostgREST.
const SYNC_ENTITY_CONCURRENCY = 3;

// ── Funções puras de mapeamento/merge (sem dependência de DOM) ──

function _valuesDiffer(a, b) {
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  return String(a) !== String(b);
}

// remote -> local (usado no Realtime e na leitura do Supabase)
function _mapFromRemote(remote, fieldMap) {
  const out = {};
  for (const [rk, lk] of Object.entries(fieldMap)) out[lk] = remote[rk];
  return out;
}

// local -> remote (usado no push/upsert)
function _mapToRemote(record, fieldMap, optionalFields) {
  const out = {};
  const opt = optionalFields && optionalFields.length ? new Set(optionalFields) : null;
  for (const [rk, lk] of Object.entries(fieldMap)) {
    let v = record[lk] ?? null;
    // Coluna *_id é FK: "" (chamado sem cliente, vindo da triagem) quebra com 23503; NULL passa
    if (v === '' && rk.endsWith('_id')) v = null;
    if (opt && opt.has(rk) && (v === null || v === '')) continue;
    out[rk] = v;
  }
  return out;
}

/**
 * Servidor trouxe versão mais nova, mas este aparelho tem edições ainda não
 * enviadas (_dirtyFields): fica a versão do servidor + os campos editados
 * aqui. A mudança de outra pessoa em OUTROS campos não se perde, e a nossa
 * também não. O registro volta a ficar mais novo, para ser enviado.
 */
function _keepLocalEdits(merged, loc, nowIso) {
  const dirty = Array.isArray(loc && loc._dirtyFields) ? loc._dirtyFields : [];
  if (!dirty.length) { delete merged._dirtyFields; return merged; }
  for (const f of dirty) { if (Object.prototype.hasOwnProperty.call(loc, f)) merged[f] = loc[f]; }
  merged._dirtyFields = dirty.slice();
  merged.updatedAt = nowIso || new Date().toISOString();
  return merged;
}

function _mergeRecords(local, remote, localKeyFromRemote) {
  const merged = [];
  let conflicts = 0;
  const conflictDetails = [];
  const remoteById = new Map(remote.map(r => [r.id, r]));
  for (const loc of local) {
    const rem = remoteById.get(loc.id);
    // Supabase is authoritative for records that no longer exist remotely.
    // Keeping these local orphans makes deleted records reappear on the next push.
    if (!rem) { continue; }
    const localTime = new Date(loc.updatedAt || 0).getTime();
    const remoteTime = new Date(rem.updated_at || 0).getTime();
    if (localTime > remoteTime) { merged.push(loc); }
    else {
      conflicts++;
      const mapped = {};
      const changedFields = [];
      for (const [rk, lk] of Object.entries(localKeyFromRemote)) {
        mapped[lk] = rem[rk];
        if (loc[lk] !== undefined && rem[rk] !== undefined && _valuesDiffer(loc[lk], rem[rk])) {
          changedFields.push({ field: lk, local: loc[lk], remote: rem[rk] });
        }
      }
      // Campos editados aqui e ainda não enviados não são perdidos (só os demais).
      const kept = new Set(Array.isArray(loc._dirtyFields) ? loc._dirtyFields : []);
      const lost = changedFields.filter((c) => !kept.has(c.field));
      if (lost.length) conflictDetails.push({ id: loc.id, name: loc.name || loc.title || loc.assunto || loc.descricao || loc.id, fields: lost });
      merged.push(_keepLocalEdits({ ...loc, ...mapped }, loc));
    }
    remoteById.delete(loc.id);
  }
  for (const rem of remoteById.values()) {
    const mapped = {};
    for (const [rk, lk] of Object.entries(localKeyFromRemote)) mapped[lk] = rem[rk];
    merged.push(mapped);
  }
  return { merged, conflicts, conflictDetails };
}

// ── Sync parcial (P-9) — planejamento puro e testável ───────────────────────
// Entrada: locais + "leves" do servidor ({id, updated_at}). Sai quais ids
// precisam da linha completa (novos no servidor ou com updated_at diferente
// do local) e quais podem ser reconstruídos do local (iguais). Comparação por
// instante (getTime), não por texto: "…+00:00" e "…Z" são o mesmo momento.
// Não usa o relógio deste aparelho: carimbos de outros aparelhos adiantados
// ou atrasados não fazem nada escapar.
function _planDeltaPull(local, light) {
  const localById = new Map((local || []).filter(r => r && r.id).map(r => [r.id, r]));
  const changedIds = [];
  const sameIds = [];
  for (const r of (light || [])) {
    if (!r || !r.id) continue;
    const loc = localById.get(r.id);
    const rt = new Date(r.updated_at || 0).getTime();
    const lt = loc ? new Date(loc.updatedAt || 0).getTime() : NaN;
    if (!loc || !r.updated_at || isNaN(rt) || isNaN(lt) || rt !== lt) changedIds.push(r.id);
    else sameIds.push(r.id);
  }
  return { changedIds, sameIds };
}

// Sync completo quando: nunca sincronizou, passou do intervalo (rede de
// segurança contra edições no servidor que não mexem em updated_at) ou a
// entidade não tem updated_at.
const FULL_SYNC_EVERY_MS = 24 * 3600000;
function _shouldFullSync(entity, lastFullAtIso, nowMs) {
  if (!entity || !entity.fields || !entity.fields.updated_at) return true;
  if (!lastFullAtIso) return true;
  const t = new Date(lastFullAtIso).getTime();
  if (isNaN(t)) return true;
  return ((typeof nowMs === 'number' ? nowMs : Date.now()) - t) >= FULL_SYNC_EVERY_MS;
}

function _needsPush(local, remote) {
  if (!remote) return true;
  return new Date(local.updatedAt || 0).getTime() > new Date(remote.updated_at || 0).getTime();
}

// ── Tombstones + plano de sync (puros, testáveis) ────────────────────────────
// Causa raiz que motivou: `_mergeRecords` trata "ausente no remoto" sempre
// como "deletado no servidor" e o descarta do merged. Isso perde registros
// criados offline (pull antes do push) e ressuscita deletes via realtime.
// Estratégia (sem refatorar o merge genérico):
// - Deleções locais geram tombstones `{ dbKey: { id: deletedAtISO } }` com TTL.
// - Push de deletes (idempotente) roda ANTES do pull/merge.
// - Linhas remotas cobertas por tombstone são filtradas, EXCETO se o remoto
//   for mais novo que o tombstone (recriado de verdade → revive).
// - Locais sem correspondente remoto são classificados: criado após o último
//   sync bem-sucedido (ou sem sync anterior) → push; mais antigo → deletado
//   no servidor → descarta do merged (propagação de delete, sem ressuscitar).
const TOMBSTONE_TTL_MS = 30 * 86400000;

function _pruneTombstones(tombs, nowMs, ttlMs) {
  const now = (typeof nowMs === 'number' && !isNaN(nowMs)) ? nowMs : Date.now();
  const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : TOMBSTONE_TTL_MS;
  const out = {};
  for (const [dbKey, ids] of Object.entries(tombs || {})) {
    const kept = {};
    for (const [id, at] of Object.entries(ids || {})) {
      if (now - new Date(at || 0).getTime() <= ttl) kept[id] = at;
    }
    if (Object.keys(kept).length) out[dbKey] = kept;
  }
  return out;
}

// Filtra linhas remotas contra os tombstones de UMA entidade.
// Retorna { remote, revived }: `remote` sem as linhas cobertas por tombstone
// staler; `revived` com os ids cujo remoto é MAIS NOVO que o tombstone
// (recriado após nossa deleção → o chamador deve limpar o tombstone e
// aceitar o remoto, sem ressuscitar nada).
function _filterRemoteByTombstones(remote, tombsForKey, updatedAtKey) {
  const tombs = tombsForKey || {};
  if (!Object.keys(tombs).length) return { remote: (remote || []).slice(), revived: [] };
  const uk = updatedAtKey || 'updated_at';
  const kept = [];
  const revived = [];
  for (const row of (remote || [])) {
    const tAt = tombs[row.id];
    if (!tAt) { kept.push(row); continue; }
    const remoteMs = new Date((row && row[uk]) || 0).getTime();
    const tombMs = new Date(tAt || 0).getTime();
    if (remoteMs > tombMs) { kept.push(row); revived.push(row.id); }
    // else: nossa deleção ainda não propagada (ou snapshot stale) → filtra.
  }
  return { remote: kept, revived };
}

// Classifica registros locais sem correspondente no remoto.
// lastSyncAt: ISO do último pull bem-sucedido da entidade (ou null/'' na
// primeira sincronização). Comparação lexicográfica vale para ISO-8601.
function _classifyLocalOnly(localOnly, lastSyncAt) {
  const toPush = [];
  const toDrop = [];
  for (const loc of (localOnly || [])) {
    const stamp = (loc && (loc.createdAt || loc.updatedAt)) || '';
    if (!lastSyncAt || (stamp && stamp >= lastSyncAt)) toPush.push(loc);
    else toDrop.push(loc);
  }
  return { toPush, toDrop };
}

// Reintegra ao merged os registros cujo push FALHOU: o merge os descarta
// (ausentes no remoto), mas descartar do dbSet local seria perda de dados.
// Retorna o mesmo array quando nada falta (sem cópia, sem duplicar).
function _retainFailedPush(merged, failedRecs) {
  if (!failedRecs || !failedRecs.length) return merged;
  const ids = new Set((merged || []).map(m => m && m.id));
  for (const rec of failedRecs) {
    if (rec && rec.id && !ids.has(rec.id)) { merged.push(rec); ids.add(rec.id); }
  }
  return merged;
}

// Export para testes (Node/Vitest). Em browser, `module` não existe e os
// identificadores acima ficam disponíveis no escopo global dos scripts.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENTITIES, SYNC_ENTITIES, _valuesDiffer, _mapFromRemote, _mapToRemote, _mergeRecords, _keepLocalEdits, _needsPush, TOMBSTONE_TTL_MS, _pruneTombstones, _filterRemoteByTombstones, _classifyLocalOnly, _retainFailedPush, _planDeltaPull, _shouldFullSync, FULL_SYNC_EVERY_MS };
}
