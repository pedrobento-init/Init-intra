// supabase-config.js - Conexão e Configuração do Supabase Cloud
// ============================================================

// Credenciais padrão (anon key é pública — segura para distribuição).
// localStorage tem prioridade para override manual (⚙ na tela de login).
const SUPABASE_URL = localStorage.getItem('intra_supabase_url')
  || 'https://esticiaufganuxhcwxzq.supabase.co';
const SUPABASE_ANON_KEY = localStorage.getItem('intra_supabase_key')
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdGljaWF1ZmdhbnV4aGN3eHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MTk3ODgsImV4cCI6MjEwMDI5NTc4OH0.ZjEBGAyH_W1uFgSBHrxdGZgidIISTqasvofP4WioqzI';

let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
        if (typeof supabase !== 'undefined') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Supabase conectado em:', SUPABASE_URL);
        } else {
            console.warn('⚠️ SDK Supabase não carregado. Usando modo offline.');
        }
    } catch (err) {
        console.warn('⚠️ Erro ao inicializar cliente Supabase:', err);
    }
} else {
    console.log('ℹ️ Supabase não configurado. Rodando em modo offline (IndexedDB local).');
}

function isSupabaseConnected() { return !!supabaseClient; }

// Função para atualizar as credenciais do Supabase via UI/Console
function setSupabaseConfig(url, key) {
    if (url) localStorage.setItem('intra_supabase_url', url.trim());
    if (key) localStorage.setItem('intra_supabase_key', key.trim());
    window.location.reload();
}

function openSupabaseConfig() {
    if (typeof openModal !== 'function') return;
    var currentUrl = localStorage.getItem('intra_supabase_url') || '';
    var currentKey = localStorage.getItem('intra_supabase_key') || '';
    document.getElementById('modalOverlay').style.zIndex = '600';
    openModal('Configurar Supabase',
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<p style="font-size:13px;color:var(--text-secondary)">Insira a URL e a chave anon do seu projeto Supabase.</p>' +
        '<div class="form-group"><label class="form-label">URL do Supabase</label>' +
        '<input class="form-input" id="cfgSupabaseUrl" value="' + escapeHtml(currentUrl) + '" placeholder="https://xxxxx.supabase.co" /></div>' +
        '<div class="form-group"><label class="form-label">Anon Key</label>' +
        '<input class="form-input" id="cfgSupabaseKey" value="' + escapeHtml(currentKey) + '" placeholder="eyJhbGciOiJIUzI1NiIs..." /></div>' +
        '<p style="font-size:11px;color:var(--text-muted)">Encontre essas informações em: Supabase Dashboard → Project Settings → API</p>' +
        '<div class="form-actions">' +
        '<button class="btn btn-secondary" onclick="closeModal();document.getElementById(\'modalOverlay\').style.zIndex=\'200\'">Cancelar</button>' +
        '<button class="btn btn-primary" onclick="saveSupabaseConfigFromModal()">Salvar e Recarregar</button>' +
        '</div></div>',
        'sm');
}

function saveSupabaseConfigFromModal() {
    var url = document.getElementById('cfgSupabaseUrl').value.trim();
    var key = document.getElementById('cfgSupabaseKey').value.trim();
    if (!url || !key) {
        if (typeof showToast === 'function') showToast('Preencha URL e Anon Key.', 'error');
        return;
    }
    setSupabaseConfig(url, key);
}

// Inicializador de escutadores em Tempo Real (Realtime WebSockets)
let _realtimeChannel = null;

const _RT_TABLE_META = {
    pendencias: {
        dbKey: 'intra_pendencias',
        map: r => ({
            id: r.id, clientId: r.client_id, clientName: r.client_name, tipo: r.tipo, descricao: r.descricao,
            responsible: r.responsible, status: r.status, priority: r.priority, deadline: r.deadline,
            notes: r.notes, linkUtil: r.link_util, team: r.team, attachments: r.attachments,
            checklist: r.checklist, tags: r.tags, timerRunning: r.timer_running, timerStartedAt: r.timer_started_at,
            timerTotalSeconds: r.timer_total_seconds, timerOperator: r.timer_operator, completedAt: r.completed_at,
            createdAt: r.created_at, updatedAt: r.updated_at
        }),
        onChange: () => {
            if (typeof updateBadges === 'function') updateBadges();
            if ((window.location.hash.replace('#','') || '') === 'pendencias' && typeof renderPendencias === 'function') renderPendencias();
        }
    },
    clients: {
        dbKey: 'intra_clients',
        map: r => ({
            id: r.id, name: r.name, cnpj: r.cnpj, segment: r.segment, color: r.color, initials: r.initials,
            logo: r.logo, logoShape: r.logo_shape, owner: r.owner, ownerPhone: r.owner_phone,
            responsible: r.responsible, responsiblePhone: r.responsible_phone, technician: r.technician,
            server: r.server, hosting: r.hosting, backup: r.backup, licenses: r.licenses, emails: r.emails,
            googleSheetUrl: r.google_sheet_url, team: r.team, notes: r.notes, attachments: r.attachments,
            createdAt: r.created_at, updatedAt: r.updated_at
        }),
        onChange: () => {
            if ((window.location.hash.replace('#','') || '') === 'clientes' && typeof renderClients === 'function') renderClients();
        }
    },
    operators: {
        dbKey: 'intra_operators',
        map: r => ({
            id: r.id, name: r.name, initials: r.initials, color: r.color, role: r.role, phone: r.phone,
            email: r.email, isAdmin: r.is_admin === true, active: r.active !== false, team: r.team || 'init',
            auth_user_id: r.auth_user_id, pinHash: r.pin_hash, pinSalt: r.pin_salt,
            createdAt: r.created_at, updatedAt: r.updated_at
        }),
        onChange: () => {
            if ((window.location.hash.replace('#','') || '') === 'operadores' && typeof renderOperadores === 'function') renderOperadores();
        }
    },
    visits: {
        dbKey: 'intra_visits',
        map: r => ({
            id: r.id, clientId: r.client_id, clientName: r.client_name, operator: r.operator, date: r.date,
            time: r.time, motivo: r.motivo, observacoes: r.observacoes, status: r.status, team: r.team,
            categories: r.categories || [], checklist: r.checklist || [],
            createdAt: r.created_at, updatedAt: r.updated_at
        }),
        onChange: () => {
            const h = window.location.hash.replace('#','') || '';
            if (h === 'visitas' && typeof renderVisitas === 'function') renderVisitas();
            if (h === 'calendario' && typeof refreshCalendar === 'function') refreshCalendar();
        }
    },
    procedures: {
        dbKey: 'intra_procedures',
        map: r => ({
            id: r.id, clientId: r.client_id, title: r.title, category: r.category, content: r.content,
            createdAt: r.created_at, updatedAt: r.updated_at
        }),
        onChange: () => {}
    },
    procedure_templates: {
        dbKey: 'intra_procedure_templates',
        map: r => ({
            id: r.id, title: r.title, category: r.category, content: r.content, createdBy: r.created_by,
            createdAt: r.created_at, updatedAt: r.updated_at
        }),
        onChange: () => {
            if ((window.location.hash.replace('#','') || '') === 'templates' && typeof renderTemplates === 'function') renderTemplates();
        }
    },
    audit_logs: {
        dbKey: 'intra_logs',
        map: r => ({
            id: r.id, operatorName: r.operator_name, action: r.action, type: r.type,
            targetId: r.target_id, details: r.details, timestamp: r.timestamp
        }),
        onChange: () => {
            if ((window.location.hash.replace('#','') || '') === 'historico' && typeof renderLogs === 'function') renderLogs();
        }
    }
};

function _applyRealtimePayload(table, payload) {
    const meta = _RT_TABLE_META[table];
    if (!meta || typeof dbGet !== 'function' || typeof dbSet !== 'function') return;
    try {
        let list = dbGet(meta.dbKey);
        if (!Array.isArray(list)) list = [];
        const event = payload.eventType || payload.event;
        if (event === 'DELETE' && payload.old) {
            const id = payload.old.id;
            list = list.filter(x => x.id !== id);
        } else if ((event === 'INSERT' || event === 'UPDATE') && payload.new) {
            const row = meta.map(payload.new);
            const idx = list.findIndex(x => x.id === row.id);
            if (idx !== -1) {
                // Não sobrescreve se local for mais novo
                const localT = new Date(list[idx].updatedAt || list[idx].timestamp || 0).getTime();
                const remoteT = new Date(row.updatedAt || row.timestamp || 0).getTime();
                if (remoteT >= localT) list[idx] = { ...list[idx], ...row };
            } else {
                list.unshift(row);
            }
        }
        if (table === 'audit_logs' && typeof setCacheTable === 'function') {
            setCacheTable('audit_logs', list);
        } else {
            dbSet(meta.dbKey, list);
        }
        if (typeof meta.onChange === 'function') meta.onChange();
    } catch (e) {
        console.warn('Realtime apply', table, e.message);
    }
}

function initSupabaseRealtime() {
    if (!supabaseClient) return;

    if (_realtimeChannel) {
        try { supabaseClient.removeChannel(_realtimeChannel); } catch (e) {}
        _realtimeChannel = null;
    }

    let channel = supabaseClient.channel('public-changes');
    Object.keys(_RT_TABLE_META).forEach(table => {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
            console.log('⚡', table, payload.eventType || payload.event);
            _applyRealtimePayload(table, payload);
        });
    });
    _realtimeChannel = channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('⚠️ Realtime:', status, '— tentando reconectar em 3s');
            setTimeout(() => {
                if (supabaseClient && document.visibilityState === 'visible') {
                    initSupabaseRealtime();
                }
            }, 3000);
        }
    });
}

// Reconecta o realtime quando a aba volta de bfcache / fica visível
if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && supabaseClient && !_realtimeChannel) {
            initSupabaseRealtime();
        }
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted && supabaseClient) {
            console.log('🔄 Página restaurada do bfcache — reconectando realtime');
            initSupabaseRealtime();
        }
    });
    window.addEventListener('DOMContentLoaded', () => {
        initSupabaseRealtime();
    });
}
