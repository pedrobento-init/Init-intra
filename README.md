# Init Intra

Portal intranet para gestao de clientes, pendencias e procedimentos de TI.

## Funcionalidades

- **Dashboard** — Visao geral com graficos de prioridade, carga de trabalho, evolucao e ranking
- **Clientes** — Cadastro completo com dados de servidor, hospedagem, backup, email, licencas e documentos
- **Pendencias** — Kanban e tabela com status, prioridade, prazo, checklist, notas, anexos e timer
- **Calendario** — Visualizacao de prazos com filtros por cliente, responsavel, status e prioridade
- **Procedimentos** — Procedimentos por cliente com templates reutilizaveis
- **Operadores** — Cadastro de tecnicos com equipes, permissoes e PIN de acesso
- **Templates** — Modelos de procedimentos aplicaveis a multiplos clientes
- **Busca global** — `Ctrl+K` para pesquisar clientes e pendencias

## Tecnologias

- **Frontend**: Vanilla JS (SPA), CSS customizado com temas claro/escuro
- **Calendario**: FullCalendar 6.x
- **Graficos**: Chart.js
- **Banco local**: IndexedDB via Dexie.js (offline-first)
- **Nuvem**: Supabase (PostgreSQL + Realtime WebSockets)
- **Email**: Resend API via Supabase Edge Functions
- **PWA**: Service Worker com cache offline, instavel como app

## Estrutura

```
Init-intra/
├── index.html          # Entrada da SPA
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker
├── icon.svg            # Icone do app
├── css/
│   └── styles.css      # Todos os estilos (temas, responsivo)
├── js/
│   ├── app.js          # Roteador, dashboard, badges
│   ├── auth.js         # Autenticacao (Supabase Auth + PIN local)
│   ├── calendar.js     # Pagina de calendario (FullCalendar)
│   ├── clients.js      # Pagina de clientes + procedimentos
│   ├── db.js           # IndexedDB (Dexie) + cache em memoria
│   ├── global-search.js# Busca global (Ctrl+K)
│   ├── notifications.js# Notificacoes e lembretes de prazo
│   ├── operadores.js   # Pagina de operadores/tecnicos
│   ├── pendencias.js   # Pagina de pendencias (kanban + tabela)
│   ├── storage.js      # Camada de dados (CRUD + sync Supabase)
│   ├── supabase-config.js # Conexao Supabase + realtime
│   ├── templates.js    # Modelos de procedimentos
│   ├── timer.js        # Timer play/pause para pendencias
│   ├── ui.js           # Componentes reutilizaveis
│   └── sw-register.js  # Registro do Service Worker
├── supabase/
│   ├── functions/
│   │   └── send-email/ # Edge Function para envio de email
│   └── migrations/     # Migrations SQL do banco
└── tests/
    └── test-validators.js
```

## Licenca

MIT
