// supabase-config.js - Conexão e Configuração do cliente remoto
// ============================================================
//
// A anon key é protegida por Row Level Security (RLS) no Supabase.
// Os valores são carregados de js/config.js (gitignored) via window.SUPABASE_CONFIG.
// Administradores podem substituir temporariamente via localStorage no console:
//   setSupabaseConfig('https://...', 'eyJ...')
//
// Para configurar: copie js/config.example.js → js/config.js e preencha os valores.

const _cfg = (typeof window !== 'undefined' && window.SUPABASE_CONFIG) || {};
const SUPABASE_URL = (typeof localStorage !== 'undefined' && localStorage.getItem('intra_supabase_url'))
  || _cfg.url || '';
const SUPABASE_ANON_KEY = (typeof localStorage !== 'undefined' && localStorage.getItem('intra_supabase_key'))
  || _cfg.anonKey || '';

let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
        if (typeof supabase !== 'undefined') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storage: window.localStorage,
                }
            });
        }
    } catch (_) {}
}

function isSupabaseConnected() { return !!supabaseClient; }

/** Uso interno/admin via console — não exposto na UI de login */
function setSupabaseConfig(url, key) {
    if (url) localStorage.setItem('intra_supabase_url', url.trim());
    if (key) localStorage.setItem('intra_supabase_key', key.trim());
    window.location.reload();
}

function openSupabaseConfig() {
    // Configuração removida da interface pública por segurança.
    return;
}

function saveSupabaseConfigFromModal() {
    return;
}

// Inicializador de escutadores em Tempo Real (Realtime WebSockets)
let _realtimeChannel = null;

// Metadados de Realtime derivados do registro central (js/schema.js)
const _RT_TABLE_META = {};
ENTITIES.forEach(e => { if (e.realtime !== false) _RT_TABLE_META[e.table] = e; });

function _realtimeTeamFilter() {
    // null = sem filtro (admin vendo todas as equipes)
    if (typeof isTeamAdmin === 'function' && isTeamAdmin()) {
        return (typeof _selectedTeam !== 'undefined' && _selectedTeam) ? _selectedTeam : null;
    }
    return typeof getCurrentTeam === 'function' ? getCurrentTeam() : null;
}

function _applyRealtimePayload(table, payload) {
    const meta = _RT_TABLE_META[table];
    if (!meta || typeof dbGet !== 'function' || typeof dbSet !== 'function') return;
    // Escrita de origem remota — nunca conta como pendência local.
    const _prevSuppress = (typeof window !== 'undefined' && window._suppressPendingSync) || false;
    if (typeof window !== 'undefined') window._suppressPendingSync = true;
    try {
        let list = dbGet(meta.dbKey);
        if (!Array.isArray(list)) list = [];
        const event = payload.eventType || payload.event;
        if (event === 'DELETE' && payload.old) {
            const id = payload.old.id;
            list = list.filter(x => x.id !== id);
        } else if ((event === 'INSERT' || event === 'UPDATE') && payload.new) {
            const row = (typeof meta.mapRow === 'function') ? meta.mapRow(payload.new) : _mapFromRemote(payload.new, meta.fields);
            // Defesa em profundidade: não aplica dados de outra equipe no cache local
            if (meta.hasTeam && typeof row.team === 'string' && typeof canViewTeam === 'function' && !canViewTeam(row.team)) return;
            const idx = list.findIndex(x => x.id === row.id);
            if (idx !== -1) {
                const localT = new Date(list[idx].updatedAt || list[idx].timestamp || 0).getTime();
                const remoteT = new Date(row.updatedAt || row.timestamp || 0).getTime();
                if (remoteT >= localT) {
                    // Preserva pin local se realtime não envia hashes
                    const prevPin = list[idx].pinHash;
                    const prevSalt = list[idx].pinSalt;
                    list[idx] = { ...list[idx], ...row };
                    if (prevPin && !row.pinHash) list[idx].pinHash = prevPin;
                    if (prevSalt && !row.pinSalt) list[idx].pinSalt = prevSalt;
                }
            } else {
                list.unshift(row);
            }
        }
        if (meta.cacheTable && typeof setCacheTable === 'function') {
            setCacheTable(meta.cacheTable, list);
        } else {
            dbSet(meta.dbKey, list);
        }
        if (typeof meta.onChange === 'function') meta.onChange();
    } catch (_) {} finally {
        if (typeof window !== 'undefined') window._suppressPendingSync = _prevSuppress;
    }
}

function initSupabaseRealtime() {
    if (!supabaseClient || !window._supabaseAuthActive) return;

    if (_realtimeChannel) {
        try { supabaseClient.removeChannel(_realtimeChannel); } catch (e) {}
        _realtimeChannel = null;
    }

    const teamFilter = _realtimeTeamFilter();
    let channel = supabaseClient.channel('public-changes');
    Object.keys(_RT_TABLE_META).forEach(table => {
        const meta = _RT_TABLE_META[table];
        const opts = { event: '*', schema: 'public', table };
        if (teamFilter && meta.hasTeam) opts.filter = `team=eq.${teamFilter}`;
        channel = channel.on('postgres_changes', opts, payload => {
            _applyRealtimePayload(table, payload);
        });
    });
    _realtimeChannel = channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (typeof syncSupabaseToLocal === 'function' && window._supabaseAuthActive) {
                syncSupabaseToLocal().catch(() => {});
            }
            setTimeout(() => {
                if (supabaseClient && document.visibilityState === 'visible' && window._supabaseAuthActive) {
                    initSupabaseRealtime();
                }
            }, 3000);
        }
    });
}

if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && supabaseClient && window._supabaseAuthActive && !_realtimeChannel) {
            initSupabaseRealtime();
        }
    });
    window.addEventListener('pageshow', (e) => {
        if (e.persisted && supabaseClient && window._supabaseAuthActive) {
            initSupabaseRealtime();
        }
    });
}
