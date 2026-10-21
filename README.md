# Init Intra

Intranet da Init para gestão de clientes, pendências, visitas e procedimentos de TI.
SPA em JavaScript puro, offline-first (IndexedDB), sincronizada com o Supabase e publicada na Vercel.

## Funcionalidades

- **Dashboard**: visão geral por perfil (prioridade, carga, evolução, ranking).
- **Pendências**: quadro kanban e tabela, assunto/descrição, checklist, notas, anexos, timer e horas trabalhadas; pendências de Gestão visíveis só para quem é Gestão.
- **Visitas**: agenda com recorrência, número da visita, checklist, fotos, relatório e roteiro; feed iCalendar por técnico (Google Agenda, Outlook, iPhone).
- **Clientes**: ficha completa, abas de inventário, acessos cifrados, equipamentos e relatório do cliente.
- **Calendário e prazos**: prazos e visitas com filtros.
- **Vencimentos**: licenças, SSL, domínios, garantias, backup e contratos, com aviso 30 e 7 dias antes e no dia.
- **Reuniões**, **Base de conhecimento**, **Modelos de procedimento** e **Checklists**.
- **Milvus**: chamados, atendimentos, dispositivos e importação de clientes.
- **Operadores**: cadastro com equipes (init, mam, bt), papéis e flags de admin/Gestão.
- **Busca global**: `Ctrl+K` para clientes, pendências e ações.
- **E-mails**: notificações de pendência e lembretes de prazo pelo Gmail do Google Workspace.
- **Celular**: os mesmos avisos como notificação (Web Push), ativados por aparelho em Configurar notificações.

## Tecnologias

- **Frontend**: JavaScript puro (sem framework), CSS próprio com tema claro/escuro, ações por delegação (`js/actions.js`).
- **Banco local**: IndexedDB via Dexie.js, com fila de envio (`js/outbox.js`) e sincronização (`js/sync-manager.js`).
- **Nuvem**: Supabase (PostgreSQL com RLS por equipe, Auth, Realtime, Storage e Edge Functions).
- **Login**: Supabase Auth (e-mail e senha).
- **Deploy**: Vercel (`npm run build` gera `build/` com assets minificados e com hash).
- **PWA**: service worker com cache offline, instalável como app.

## Estrutura

```
index.html            Entrada da SPA (sem handlers inline)
sw.js                 Service worker
css/styles.css        Estilos
js/                   Um arquivo por tela/módulo (storage*, sync*, pendencias*, visitas, clients*, milvus-*, ...)
tools/                Build (build-config.js gera js/config.js; build-assets.js monta build/)
supabase/migrations/  Migrations SQL numeradas (aplicar em ordem no SQL Editor)
supabase/functions/   Edge Functions (Deno)
tests/                Testes unitários (Vitest)
e2e/                  Testes de navegador (Playwright)
.github/workflows/    CI: lint, testes e validação do build em cada PR
```

### Edge Functions

| Função | Para quê |
| --- | --- |
| `send-email` | Envia e-mail pelo Gmail (SMTP). Só operador logado, só para e-mails de operadores ativos. |
| `avisos-prazo` | Lembretes de prazo e avisos de vencimento, uma vez por dia pelo `pg_cron` (migration 051). Também por push, se configurado. |
| `send-push` | Notificação no celular (Web Push). Só operador logado, só para operadores ativos; chaves VAPID nos secrets (migration 053). |
| `agenda-ics` | Feed iCalendar da agenda do técnico (token secreto no link). |
| `robo` | Tarefas do robô Apps Script: agenda de vencimentos, checagem de domínios (RDAP), e-mail "Seu dia", planilha de indicadores e backup no Drive (migration 059). Ver [GOOGLE-AGENDA.md](GOOGLE-AGENDA.md). |
| `google-agenda` | Ponte com o robô Apps Script que mantém as visitas na agenda Google do técnico, nos dois sentidos (migration 057). Instalação em [GOOGLE-AGENDA.md](GOOGLE-AGENDA.md). |
| `ia-relatorio` | Texto de relatório com IA. |
| `update-user-password` | Admin troca a senha de um usuário. |
| `milvus-*` | Integração com o Milvus (chamados, atendimentos, dispositivos, clientes). |

## Desenvolvimento

```bash
npm ci
cp js/config.example.js js/config.js   # coloque a URL e a anon key do Supabase
npm run dev                            # vercel dev
npm test                               # testes unitários
npm run test:e2e                       # testes de navegador
npm run lint
```

Sem `js/config.js`, o app roda em modo local com dados de demonstração.

## Deploy

- **Site**: a Vercel roda `npm run build` (variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY`).
- **Banco**: migrations em `supabase/migrations/`, aplicadas em ordem no SQL Editor. Cada arquivo explica no cabeçalho o que muda e como verificar.
- **Edge Functions**: `supabase functions deploy <nome>`. Secrets com `supabase secrets set` (ex.: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `AVISOS_CRON_SECRET`).

## Ícones PWA

Abra `tools/generate-icons.html` no navegador para gerar `icon-192.png` e `icon-512.png`.

## Licença

MIT
