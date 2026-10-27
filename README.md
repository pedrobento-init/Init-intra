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

## Como o trabalho anda

Para quem está chegando. O detalhe de cada tela está no app; aqui fica o fluxo e
o vocabulário.

**Chamado é a pendência.** Não existe entidade separada: o que o cliente pede e o
que a equipe anota vivem no mesmo registro, com o mesmo SLA, cronômetro, anexos e
sincronização. Por isso um chamado pode estar ligado a cliente, visita,
equipamento e chamado Milvus — é o que um helpdesk genérico não faz.

**De onde nasce.** Pelo botão no app; por e-mail de cliente no rótulo "Pendências"
do Gmail, que a triagem abre já preenchido; por mensagem de WhatsApp, que passa
pela mesma triagem; pelo Milvus; e pelo robô, quando um backup monitorado falha
ou fica em silêncio além do limite.

**Os status** (`js/ui.js`, `STATUS_PEN_MAP`): Aberto → Em Andamento, podendo
passar por Pausado, Aguard. Terceiro ou Aguard. Cliente, e terminando em
Resolvido ou Cancelado. `concluido` e `fechado` saíram das opções, mas seguem
sendo contados para não ressuscitar registro antigo.

**O prazo sai da prioridade** (`js/sla.js`), em horas e dias **úteis**:

| Prioridade | 1ª resposta | Resolução |
| --- | --- | --- |
| Crítica | 1 h | no mesmo dia |
| Alta | 4 h | 1 dia útil |
| Média | 8 h | 3 dias úteis |
| Baixa | 24 h | 7 dias úteis |

**O que conta como primeira resposta** é só a nota marcada como resposta ao
solicitante (`visibility: 'resposta'`). Anotação interna não conta, e a nota que
veio da resposta do cliente (`'solicitante'`) também não — senão o relógio
pararia sozinho sem ninguém ter respondido.

**Onde fica cada coisa:** **Pendências** alterna entre quadro e fila (a escolha e
a ordenação ficam no aparelho); **Fila** é a tabela ordenada no servidor;
**Calendário** junta prazos e visitas; o **⋯** guarda o resto — clientes,
vencimentos, reuniões, base de conhecimento, checklists, Milvus, operadores e
indicadores. `Ctrl+K` acha cliente, pendência ou ação de qualquer lugar.

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
| `ia-levar` | Sugere o que levar para a visita (IA). |
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
