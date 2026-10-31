// storage-operadores.js – Usuário, operadores, dados de exemplo e validação.
// Parte da camada de dados (antes um único storage.js de 3.400 linhas). Scripts
// clássicos: carregam logo depois de storage.js e compartilham os mesmos globais.
// Nos testes, tests/_storage.cjs junta as partes na mesma ordem.

// ── USER ──
function getUser() {
  const session = getSession();
  if (session) return { name: session.name, initials: session.initials, color: session.color, role: session.role };
  if (typeof getCacheTable === 'function') {
    const entry = getCacheTable('user_profile');
    return entry?.value || { name: 'Suporte TI', initials: 'TI' };
  }
  return dbGetObj(DB.USER, { name: 'Suporte TI', initials: 'TI' });
}

function saveUser(data) {
  if (typeof setCacheTable === 'function') {
    setCacheTable('user_profile', { key: DB.USER, value: data });
  } else {
    dbSet(DB.USER, data);
  }
}

// ── OPERATORS ──
function getOperators() {
  return dbGet(DB.OPERATORS);
}
function getOperatorById(id) { return getOperators().find(o => o.id === id) || null; }
function getOperatorByEmail(email) {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return getOperators().find(o => o.email?.toLowerCase() === e) || null;
}
function getOperatorByAuthId(authUserId) {
  if (!authUserId) return null;
  return getOperators().find(o => o.auth_user_id === authUserId) || null;
}
/** Reescreve localmente o nome da pessoa nos registros dela (sem gerar envio). */
function _propagateOperatorRename(opId, oldName, newName) {
  const same = (id, name) => (id ? id === opId : name === oldName);
  const jobs = [
    [DB.PENDENCIAS, (r) => { let c = false; if (same(r.responsibleId, r.responsible)) { r.responsible = newName; c = true; } if (r.timerOperator && same(r.timerOperatorId, r.timerOperator)) { r.timerOperator = newName; c = true; } return c; }],
    [DB.VISITS, (r) => { if (same(r.operatorId, r.operator)) { r.operator = newName; return true; } return false; }],
    [DB.VENCIMENTOS, (r) => { if (r.responsavel && same(r.responsavelId, r.responsavel)) { r.responsavel = newName; return true; } return false; }],
    [DB.TIME_ENTRIES, (r) => { if (same(r.operatorId, r.operatorName)) { r.operatorName = newName; return true; } return false; }],
  ];
  const prev = typeof window !== 'undefined' ? window._suppressPendingSync : undefined;
  try {
    if (typeof window !== 'undefined') window._suppressPendingSync = true;
    for (const [key, fn] of jobs) {
      if (!key) continue;
      const list = dbGet(key) || [];
      let changed = false;
      for (const r of list) { if (r && fn(r)) changed = true; }
      if (changed) dbSet(key, list);
    }
  } catch (_) {
  } finally {
    if (typeof window !== 'undefined') window._suppressPendingSync = prev;
  }
}

async function saveOperator(data) {
  const list = getOperators();
  const isEdit = !!data.id;
  const prevName = isEdit ? ((list.find(o => o.id === data.id) || {}).name || null) : null;
  
  var now = new Date().toISOString();

  // Senha: quem guarda é o Supabase Auth. Antes um hash (SHA-256) da MESMA
  // senha de login ia para operators — legível por todos os autenticados —
  // e para o cache do aparelho. Não guardamos mais nada aqui.
  delete data.pin;
  delete data.pinHash;
  delete data.pinSalt;

  let savedOp;
  if (isEdit) {
    const i = list.findIndex(o => o.id === data.id);
    if (i !== -1) {
      list[i] = { ...list[i], ...data, updatedAt: now };
      savedOp = list[i];
    } else {
      // Undo/restauração: id existe mas saiu da lista (delete) — reinsere em
      // vez de só retornar (antes o restore local era silenciosamente perdido).
      savedOp = { ...data, createdAt: data.createdAt || now, updatedAt: now };
      list.push(savedOp);
    }
  } else {
    // Backstop além da UI (validateOperator): outros chamadores não passam
    // pelo form — criação com e-mail repetido lança em vez de duplicar.
    if (data.email) {
      const dupe = list.find(o => o && o.email && String(o.email).trim().toLowerCase() === String(data.email).trim().toLowerCase());
      if (dupe) throw new Error('Já existe um operador com este e-mail (' + dupe.name + ').');
    }
    data.id = nextId('OP');
    data.createdAt = now;
    data.updatedAt = now;
    data.active = true;
    data.onLeave = data.onLeave === true;
    list.push(data);
    savedOp = data;
  }
  // Nenhum resquício de hash de senha no registro (cópias antigas do aparelho).
  if (savedOp) { delete savedOp.pinHash; delete savedOp.pinSalt; }
  // ensure boolean normalization for onLeave
  if (savedOp) savedOp.onLeave = savedOp.onLeave === true;
  dbSet(DB.OPERATORS, list);
  // Renomeou: os registros dessa pessoa passam a mostrar o nome novo (o banco
  // faz o mesmo pelo id — migration 049 — e manda no próximo sync).
  if (prevName && savedOp && savedOp.name && savedOp.name !== prevName) _propagateOperatorRename(savedOp.id, prevName, savedOp.name);
  
  // Sync the current session if this operator is the one logged in
  const session = getSession();
  if (session && session.opId === savedOp.id) {
    setSession(savedOp.id);
    if (typeof updateUserUI === 'function') updateUserUI();
  }
  
  addLog(isEdit ? 'Editou' : 'Criou', 'Operador', savedOp.id, savedOp.name);

  // Sync to Supabase using the MERGED operator data (savedOp), not the partial form data
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('operators').upsert({
      id: savedOp.id,
      name: savedOp.name,
      initials: savedOp.initials,
      color: savedOp.color,
      role: savedOp.role,
      phone: savedOp.phone,
       email: savedOp.email,
       auth_user_id: savedOp.auth_user_id || null,
      is_admin: savedOp.isAdmin === true,
      is_gestao: savedOp.isGestao === true,
       active: savedOp.active !== false,
       team: savedOp.team || 'init',
      on_leave: savedOp.onLeave === true,
      created_at: savedOp.createdAt || now,
      updated_at: now
    }).then(res => {
      if (res.error) {
        if (res.error.code === 'PGRST204' || (res.error.message && res.error.message.includes('column'))) {
          console.warn('⚠️ Supabase operadores: schema incompleto (coluna ausente?). Use o script de migração.');
        } else {
          console.warn('⚠️ Supabase operadores:', res.error.message);
        }
        markSyncPushFailed();
      }
    }).catch(err => { console.warn('⚠️ Erro de rede ao salvar operador:', err.message); markSyncPushFailed(); });
  }

  return savedOp;
}
function deleteOperator(id) {
  if (!canManageOps()) {
    if (typeof showToast === 'function') showToast('Permissão negada para excluir operadores.', 'error');
    return false;
  }
  const op = getOperatorById(id);
  const name = op ? op.name : 'Desconhecido';
  dbSet(DB.OPERATORS, getOperators().filter(o => o.id !== id));
  _addTombstone(DB.OPERATORS, id);
  addLog('Excluiu', 'Operador', id, name);

  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    supabaseClient.from('operators').delete().eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase excluir operador:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
  }
}
function toggleOperatorActive(id) {
  const list = getOperators();
  const i = list.findIndex(o => o.id === id);
  if (i !== -1) {
    list[i].active = !list[i].active;
    dbSet(DB.OPERATORS, list);
    addLog(list[i].active ? 'Ativou' : 'Desativou', 'Operador', id, list[i].name);

    if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
      supabaseClient.from('operators').update({ active: list[i].active }).eq('id', id).then(res => { if(res.error) { console.error('❌ Supabase toggle operador:', res.error); markSyncPushFailed(); } }).catch(() => markSyncPushFailed());
    }
  }
}

function isCurrentAdmin() {
  const session = getSession();
  if (!session) return false;
  const op = getOperatorById(session.opId);
  return op ? (op.isAdmin === true && op.active !== false) : false;
}

const PERMISSIONS = {
  admin:    { delete: true, editAll: true, manageOps: true, viewAll: true, export: true },
  supervisor: { delete: false, editAll: true, manageOps: false, viewAll: true, export: true },
  tecnico:  { delete: false, editAll: false, manageOps: false, viewAll: false, export: false }
};

function getCurrentPermissions() {
  const session = getSession();
  if (!session) return PERMISSIONS.tecnico;
  const op = getOperatorById(session.opId);
  if (!op || op.active === false) return PERMISSIONS.tecnico;
  if (op.isAdmin) return PERMISSIONS.admin;
  const roleLower = (op.role || '').toLowerCase();
  if (roleLower.includes('supervisor') || roleLower.includes('gerente') || roleLower.includes('coordenador')) return PERMISSIONS.supervisor;
  return PERMISSIONS.tecnico;
}

function canDelete() { return getCurrentPermissions().delete; }
function canEditAll() { return getCurrentPermissions().editAll; }
function canManageOps() { return getCurrentPermissions().manageOps; }
function canViewAll() { return getCurrentPermissions().viewAll; }
function canExport() { return getCurrentPermissions().export; }

// ── SEED ──
function seedDemoData() {
  if (typeof isSupabaseConnected === 'function' && isSupabaseConnected() && window._supabaseAuthActive) {
    console.log('ℹ️ Supabase conectado — seed de demonstração pulado.');
    return;
  }
  if (getClients().length > 0) return;
  // Carga inicial local — não é mudança pendente do usuário (não conta no banner).
  if (typeof window !== 'undefined') window._suppressPendingSync = true;

  // Seed operators (emails usam .example.local — domínio reservado, sem relação com endereços reais)
  if (getOperators().length === 0) {
    const operators = [
      { id:'OP-1', name:'Pedro',   initials:'PE', color:'#1a56db', role:'Técnico',   phone:'', email:'op1@example.local',   auth_user_id:null, active:true, isAdmin:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-2', name:'Giovane', initials:'GI', color:'#0891b2', role:'Técnico',   phone:'', email:'op2@example.local', auth_user_id:null, active:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-3', name:'Rafael',  initials:'RA', color:'#0f766e', role:'Técnico',   phone:'', email:'op3@example.local',  auth_user_id:null, active:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-4', name:'Joarli',  initials:'JO', color:'#4f46e5', role:'Técnico',   phone:'', email:'op4@example.local',  auth_user_id:null, active:true, isGestao:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
      { id:'OP-5', name:'Felipe',  initials:'FE', color:'#6366f1', role:'CEO',       phone:'', email:'op5@example.local', auth_user_id:null, active:true, isAdmin:true, isGestao:true, team:'init', createdAt:'2025-01-01T00:00:00Z', updatedAt:'2025-01-01T00:00:00Z' },
    ];
    dbSet(DB.OPERATORS, operators);
    const c = dbGetObj(DB.COUNTER, {});
    c['OP'] = 5;
    dbSet(DB.COUNTER, c);
  }

  const clients = [
    {
      id: 'CLI-1', createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z', team: 'init',
      name: 'Padaria Central', cnpj: '12.345.678/0001-90', segment: 'Alimentação',
      color: '#f97316', initials: 'PC',
      owner: 'Carlos Mendes', ownerPhone: '(11) 99999-1111',
      responsible: 'Ana Lima', responsiblePhone: '(11) 98888-2222',
      technician: 'João Silva',
      server: { type: 'Físico', os: 'Windows Server 2019', ip: '192.168.1.10', remoteAccess: 'AnyDesk', remoteId: '123456789', notes: 'Senha padrão no cofre' },
      hosting: { provider: 'HostGator', panelUrl: 'https://painel.hostgator.com', user: 'padaria@email.com', notes: 'Plano Business' },
      backup: { frequency: 'Diário', time: '23:00', destination: 'HD Externo + Google Drive', tool: 'Acronis', lastCheck: '2025-04-20', notes: '' },
      licenses: [{ software: 'Windows Server 2019', key: 'XXXXX-XXXXX-XXXXX', expiry: '2027-12-31' }],
      emails: { provider: 'Google Workspace', domain: 'padariacentral.com.br', server: 'smtp.gmail.com', port: '587', quota: '30GB/usuário' },
      notes: 'Cliente prioritário. Não realizar manutenção em horário comercial sem aviso prévio.'
    },
    {
      id: 'CLI-2', createdAt: '2025-02-15T10:00:00Z', updatedAt: '2025-02-15T10:00:00Z', team: 'init',
      name: 'Distribuidora Ômega', cnpj: '98.765.432/0001-10', segment: 'Distribuição',
      color: '#6366f1', initials: 'DO',
      owner: 'Roberto Prado', ownerPhone: '(11) 97777-3333',
      responsible: 'Fernanda Costa', responsiblePhone: '(11) 96666-4444',
      technician: 'Maria Santos',
      server: { type: 'Cloud (AWS)', os: 'Ubuntu 22.04', ip: '54.12.34.56', remoteAccess: 'SSH + VPN', remoteId: '', notes: 'Acesso via chave SSH' },
      hosting: { provider: 'AWS', panelUrl: 'https://console.aws.amazon.com', user: 'admin@omega.com.br', notes: 'EC2 t3.medium' },
      backup: { frequency: 'Semanal', time: '02:00 Domingo', destination: 'S3 Bucket', tool: 'AWS Backup', lastCheck: '2025-04-14', notes: '' },
      licenses: [],
      emails: { provider: 'Microsoft 365', domain: 'omega.com.br', server: 'outlook.office365.com', port: '993', quota: '50GB/usuário' },
      notes: 'Qualquer mudança precisa de aprovação do Roberto.'
    },
    {
      id: 'CLI-3', createdAt: '2025-03-01T10:00:00Z', updatedAt: '2025-03-01T10:00:00Z', team: 'init',
      name: 'Al Marques', cnpj: '11.222.333/0001-44', segment: 'Varejo',
      color: '#22c55e', initials: 'AM',
      owner: 'Al Marques', ownerPhone: '(11) 91111-5555',
      responsible: 'Al Marques', responsiblePhone: '(11) 91111-5555',
      technician: 'João Silva',
      server: { type: 'Físico', os: 'Windows 11', ip: '192.168.0.5', remoteAccess: 'TeamViewer', remoteId: '987654321', notes: '' },
      hosting: { provider: '', panelUrl: '', user: '', notes: '' },
      backup: { frequency: 'Mensal', time: '', destination: 'HD Externo', tool: 'Manual', lastCheck: '2025-03-01', notes: '' },
      licenses: [],
      emails: { provider: 'Gmail', domain: 'gmail.com', server: '', port: '', quota: '' },
      notes: ''
    }
  ];

  const pendencias = [
    {
      id: 'PEN-1', createdAt: '2025-04-28T08:00:00Z', updatedAt: '2025-04-29T14:00:00Z', team: 'init',
      clientId: 'CLI-1', clientName: 'Padaria Central',
      tipo: 'Projeto', assunto: 'Cabeamento estruturado', descricao: 'Cabeamento estruturado no andar 2',
      responsible: 'Pedro', status: 'em_andamento', priority: 'media',
      deadline: '2025-05-15', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-2', createdAt: '2025-04-29T10:00:00Z', updatedAt: '2025-04-29T10:00:00Z', team: 'init',
      clientId: 'CLI-2', clientName: 'Distribuidora Ômega',
      tipo: 'Projeto', assunto: 'Migração para AWS', descricao: 'Migração para AWS',
      responsible: 'Giovane', status: 'em_andamento', priority: 'alta',
      deadline: '2025-06-01', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-3', createdAt: '2025-04-30T07:00:00Z', updatedAt: '2025-04-30T07:00:00Z', team: 'init',
      clientId: 'CLI-3', clientName: 'Al Marques',
      tipo: 'Suporte', assunto: 'Verificação mensal de backup', descricao: 'Verificação mensal de backup e segurança',
      responsible: 'Rafael', status: 'aberto', priority: 'baixa',
      deadline: '', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-4', createdAt: '2025-05-01T09:00:00Z', updatedAt: '2025-05-01T09:00:00Z', team: 'init',
      clientId: 'CLI-1', clientName: 'Padaria Central',
      tipo: 'Manutenção', assunto: 'Atualização do antivírus', descricao: 'Atualização do antivírus em todos os terminais',
      responsible: 'Joarli', status: 'aberto', priority: 'media',
      deadline: '2025-05-20', notes: [], linkUtil: ''
    },
    {
      id: 'PEN-5', createdAt: '2025-05-02T11:00:00Z', updatedAt: '2025-05-02T11:00:00Z', team: 'init',
      clientId: 'CLI-2', clientName: 'Distribuidora Ômega',
      tipo: 'Suporte', assunto: 'Configurar VPN', descricao: 'Configurar VPN para novos colaboradores',
      responsible: 'Felipe', status: 'em_andamento', priority: 'alta',
      deadline: '2025-05-10', notes: [], linkUtil: ''
    }
  ];

  const procedures = [
    {
      id: 'PROC-1', clientId: 'CLI-1', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z',
      title: 'Acesso remoto via AnyDesk', category: 'Acesso',
      content: '1. Abrir AnyDesk\n2. Inserir ID: 123456789\n3. Solicitar senha ao responsável (Carlos Mendes)\n4. Aceitar a conexão no computador do cliente\n\nObservação: Sempre avisar antes de conectar.'
    },
    {
      id: 'PROC-2', clientId: 'CLI-1', createdAt: '2025-01-16T10:00:00Z', updatedAt: '2025-01-16T10:00:00Z',
      title: 'Verificação do backup diário', category: 'Backup',
      content: '1. Acessar o servidor via AnyDesk\n2. Abrir o Acronis True Image\n3. Verificar o log do último backup (deve ser às 23h)\n4. Confirmar que o backup no Google Drive está sincronizado\n5. Registrar verificação na planilha de controle'
    },
    {
      id: 'PROC-3', clientId: 'CLI-2', createdAt: '2025-02-20T10:00:00Z', updatedAt: '2025-02-20T10:00:00Z',
      title: 'Acesso SSH ao servidor AWS', category: 'Acesso',
      content: '1. Conectar à VPN da Ômega\n2. Abrir terminal: ssh -i ~/.ssh/omega.pem ubuntu@54.12.34.56\n3. Senha da VPN disponível no cofre\n\nATENÇÃO: Nunca fazer sudo rm sem aprovação do Roberto Prado.'
    }
  ];

  const procedureTemplates = [
    {
      id: 'TPL-1', createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-10T10:00:00Z',
      title: 'Verificação Padrão de Backup', category: 'Backup',
      createdBy: 'Felipe',
      content: '1. Acessar o servidor via Acesso Remoto.\n2. Abrir o software de backup (ex: Acronis, AWS Backup, Veeam).\n3. Verificar status do último job executado.\n4. Validar espaço disponível no destino do backup.\n5. Registrar resultado da verificação.'
    },
    {
      id: 'TPL-2', createdAt: '2025-01-12T10:00:00Z', updatedAt: '2025-01-12T10:00:00Z',
      title: 'Configuração de Acesso Remoto Padrão', category: 'Acesso',
      createdBy: 'Pedro',
      content: '1. Instalar o aplicativo de acesso remoto no estação/servidor.\n2. Definir senha não supervisionada / permanente segura.\n3. Cadastrar ID no sistema e salvar no cofre de senhas.\n4. Realizar teste de conexão antes de liberar ao suporte.'
    },
    {
      id: 'TPL-3', createdAt: '2025-01-15T10:00:00Z', updatedAt: '2025-01-15T10:00:00Z',
      title: 'Checklist de Onboarding de Novo Usuário', category: 'Usuários',
      createdBy: 'Giovane',
      content: '1. Criar conta de e-mail corporativo.\n2. Cadastrar usuário no Active Directory / Servidor de Arquivos.\n3. Aplicar permissões de pastas conforme departamento.\n4. Configurar conta no smartphone/notebook do usuário.\n5. Enviar credenciais temporárias de forma segura.'
    }
  ];

  dbSet(DB.CLIENTS, clients);
  dbSet(DB.PENDENCIAS, pendencias);
  dbSet(DB.PROCEDURES, procedures);
  if (getProcedureTemplates().length === 0) {
    dbSet(DB.PROCEDURE_TEMPLATES, procedureTemplates);
  }
  const currentCounters = dbGetObj(DB.COUNTER, { CLI: 3, PEN: 5, PROC: 3, OP: 5 });
  dbSet(DB.COUNTER, { ...currentCounters, CLI: 3, PEN: 5, PROC: 3, TPL: 3, OP: 5 });
  if (typeof window !== 'undefined') window._suppressPendingSync = false;
}

// ── VALIDAÇÃO ──
const Validators = {
  cpf(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
    let rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(d[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    return rev === parseInt(d[10]);
  },

  cnpj(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
    const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(d[i]) * weights1[i];
    let rem = sum % 11;
    const digit1 = rem < 2 ? 0 : 11 - rem;
    if (parseInt(d[12]) !== digit1) return false;
    sum = 0;
    for (let i = 0; i < 13; i++) sum += parseInt(d[i]) * weights2[i];
    rem = sum % 11;
    const digit2 = rem < 2 ? 0 : 11 - rem;
    return parseInt(d[13]) === digit2;
  },

  email(v) {
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  },

  phone(v) {
    if (!v) return true;
    const d = v.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 11;
  },

  required(v) {
    return v && v.trim().length > 0;
  }
};

function validateClient(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  // CNPJ/CPF é opcional e aceita qualquer valor (não validamos dígitos verificadores)
  if (data.ownerPhone && !Validators.phone(data.ownerPhone)) errors.push('Telefone do proprietário inválido.');
  if (data.responsiblePhone && !Validators.phone(data.responsiblePhone)) errors.push('Telefone do responsável inválido.');
  return errors;
}

function validatePendencia(data) {
  const errors = [];
  if (!Validators.required(data.assunto)) errors.push('Assunto é obrigatório.');
  if (!Validators.required(data.descricao)) errors.push('Descrição é obrigatória.');
  if (data.linkUtil && !/^https?:\/\//.test(data.linkUtil) && !/^mailto:/.test(data.linkUtil)) errors.push('Link inválido (use https://...).');
  return errors;
}

function validateTicket(data) {
  const errors = [];
  if (!Validators.required(data.title)) errors.push('Título é obrigatório.');
  if (data.technician && data.technician.includes('@') && !Validators.email(data.technician)) errors.push('E-mail do técnico inválido.');
  return errors;
}

function validateOperator(data) {
  const errors = [];
  if (!Validators.required(data.name)) errors.push('Nome é obrigatório.');
  if (data.email && !Validators.email(data.email)) errors.push('E-mail inválido.');
  if (data.phone && !Validators.phone(data.phone)) errors.push('Telefone inválido.');
  if (data.initials && data.initials.length > 3) errors.push('Iniciais devem ter no máximo 3 caracteres.');
  // Nome único entre ativos (049): dois "Pedro" misturavam fila, contagens e agenda.
  if (data.name && data.active !== false) {
    try {
      const n = String(data.name).trim().toLowerCase();
      const dupeName = getOperators().find(o => o && o.id !== data.id && o.active !== false && String(o.name || '').trim().toLowerCase() === n);
      if (dupeName) errors.push('Já existe um operador ativo chamado "' + dupeName.name + '". Use um nome diferente (ex.: com sobrenome).');
    } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-operadores'); }
  }
  // Anti-duplicata: criação com e-mail já cadastrado (case-insensitive).
  // Edição (com id) passa — o próprio registro é ignorado na comparação.
  if (!data.id && data.email) {
    try {
      const dupe = getOperators().find(o => o && o.email && o.email.trim().toLowerCase() === String(data.email).trim().toLowerCase());
      if (dupe) errors.push('Já existe um operador com este e-mail (' + dupe.name + ').');
    } catch (_e) { if (typeof _logSilent === 'function') _logSilent(_e, 'storage-operadores'); }
  }
  return errors;
}

function validateTemplate(data) {
  const errors = [];
  if (!Validators.required(data.title)) errors.push('Título é obrigatório.');
  if (!Validators.required(data.content)) errors.push('Conteúdo é obrigatório.');
  return errors;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _withDirtyFields, operatorIdByName, isSameOperator, getOperators, saveOperator, getPendingSyncCount, incrementPendingSync, resetPendingSyncCount, markSyncPushFailed, dbSet, dbGet, DB, parseMentionedOperators, highlightMentions, getClientDocuments, addClientDocument, removeClientDocument, _dataUrlToBlob, attachmentStoragePath, signedStorageUrls, fillSignedAttachmentLinks, applyPendenciaPageFilters, penOrigemDe, penContarOrigens, countPendenciaStatuses, penSortRemoteCol, fetchPendenciasPage, syncSupabaseToLocal, triggerStartupSync, checkBackendConnectivity, _withSyncTimeout, _isConnectivityError, _isAuthError, _refreshSupabaseSession, nextVisitNumero, maintainVisitNumeros, validateOperator, isPendenciaGestao, isGestaoOperator, canViewGestao, canViewPendencia, filterGestaoPendencias, isGestaoLog, filterGestaoLogs, getMyPendencias, getPendenciasByTeam, getPendencias, getPendenciaById, savePendencia, updatePendenciaAssignee, deletePendencia };
}
