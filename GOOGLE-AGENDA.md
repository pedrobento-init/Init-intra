# Google Agenda (visitas nos dois sentidos)

Um **Google Apps Script** roda de minuto em minuto numa conta Google da empresa,
o "robô" (por exemplo `agenda@empresa.com.br`). Cada técnico compartilha a
própria agenda com o robô, e o robô mantém visitas e eventos iguais.

Não precisa do Google Cloud Console, de OAuth nem de administrador do Workspace.

| No site | Na agenda Google do técnico (até 1 min) |
| --- | --- |
| Cria visita | Evento criado na agenda principal |
| Muda data, horário, cliente, motivo, observações ou status | Evento atualizado (concluída ganha ✓ no título) |
| Cancela ou exclui a visita | Evento apagado |
| Passa a visita para outro técnico | Sai da agenda de um e entra na do outro |

| Na agenda Google | No site (até 1 min) |
| --- | --- |
| Arrasta o evento / muda data ou horário | Visita muda de data/horário |
| Marca ou desmarca "dia inteiro" | Visita muda igual |
| Apaga o evento | Visita **agendada** vira **cancelada** (concluída não muda) |
| Muda título ou descrição | Nada (na próxima edição no site o evento volta ao padrão) |
| Cria um evento novo direto no Google | Nada (visita precisa de cliente; crie pelo site) |

Se a visita foi editada no site e ainda não chegou ao Google, o site vence.

A agenda do técnico é o **e-mail dele no cadastro de Operadores**, que precisa ser o da conta Google.
O link ICS antigo ("só para ver") continua no mesmo modal para quem usa Outlook ou iPhone.

## Instalação (uma vez)

### 1. Supabase

1. Rode `supabase/migrations/057_google_agenda.sql` no SQL Editor.
2. No terminal:

```bash
supabase secrets set AGENDA_SYNC_SECRET=<segredo longo e aleatório>
supabase secrets set APP_URL=https://<endereço do Intra>   # opcional: link no evento
supabase functions deploy google-agenda --no-verify-jwt
```

### 2. Conta do robô

Use uma conta Google da empresa só para isso (recomendado), por exemplo `agenda@empresa.com.br`.
Pode ser a sua conta, mas os eventos e o histórico ficam ligados a ela.

### 3. Apps Script (logado na conta do robô)

1. Abra <https://script.google.com> → **Novo projeto** → dê o nome `Init Intra — Agenda`.
2. Apague o conteúdo de `Código.gs` e cole o de [`tools/google-agenda-apps-script/Codigo.gs`](tools/google-agenda-apps-script/Codigo.gs).
3. **Serviços** (o "+" à esquerda) → **Google Calendar API** → **Adicionar**. O identificador precisa ficar `Calendar`.
4. **Configurações do projeto** (engrenagem) → **Propriedades do script** → adicione:
   - `SYNC_URL` = `https://<ref-do-projeto>.supabase.co/functions/v1/google-agenda`
   - `SYNC_SECRET` = o mesmo valor de `AGENDA_SYNC_SECRET`
5. Volte ao editor, escolha a função **`instalar`** e clique em **Executar**. Autorize com a conta do robô.
   - Se aparecer "O Google não verificou este app": clique em **Avançado → Acessar Init Intra — Agenda**.
     O app é seu, então isso é esperado.
6. Em **Acionadores** (relógio) deve aparecer `sincronizar`, a cada minuto.

(Opcional: em Configurações do projeto, marque "Mostrar o arquivo de manifesto" e cole
[`appsscript.json`](tools/google-agenda-apps-script/appsscript.json). Isso fixa o fuso e as permissões.)

### 4. Cada técnico (uma vez)

No Google Agenda pelo computador: **Configurações** → sua agenda → **Compartilhar com pessoas
específicas** → adicione o e-mail do robô com **Fazer alterações nos eventos**.

O modal **Visitas → Agenda no celular** mostra esse passo a passo, o e-mail do robô e o estado
("sincronizando" ou o erro). Assim que a agenda é liberada, as visitas de 7 dias atrás em diante vão para ela.

## Conferir

```sql
SELECT * FROM public.google_agenda_runner;  -- last_run_at muda a cada minuto
SELECT operator_id, calendar_id, ok, last_error FROM public.google_agenda_calendars;
SELECT count(*), max(attempts) FROM public.google_agenda_queue;  -- perto de 0
```

- Para ver erros do robô, abra o Apps Script → **Execuções**.
- `last_error` "Agenda não compartilhada": o técnico ainda não liberou a agenda, ou o e-mail do cadastro não é o da conta Google.
- O modal avisa "sincronização parada" quando o robô fica mais de 15 minutos sem rodar.
  Abra Execuções para ver o motivo. O mais comum é a senha da conta do robô ter mudado; nesse caso, rode `instalar` de novo.
- Uma visita que falha 10 vezes seguidas sai da fila. Ela volta na próxima edição dessa visita.

## Outras tarefas do robô (Robo.gs)

O mesmo projeto do Apps Script também cuida destas tarefas. A regra de cada uma fica na Edge Function `robo`.

| Quando | O quê |
| --- | --- |
| De hora em hora | Agenda **"Vencimentos Init"**: cada vencimento ativo vira um evento de dia inteiro, que não ocupa a agenda de ninguém. A equipe ativa recebe acesso só de leitura. Vencimento encerrado ou excluído sai da agenda. |
| Por volta das 8h | E-mail **"Seu dia"** para cada pessoa: visitas de hoje (com o "O que levar"), pendências vencidas ou que vencem hoje e vencimentos dos próximos 7 dias. Admin vê os vencimentos da equipe e os domínios com data diferente do registro. Dia sem nada não gera e-mail; no fim de semana, só recebe quem tem visita. Opcional: texto da equipe num espaço do Google Chat. |
| De madrugada | **Domínios:** para vencimentos do tipo "Domínio", consulta a expiração no registro público (RDAP; `.br` vai ao registro.br). **Planilha "Init Intra — Indicadores"**, reescrita toda noite, com as abas Resumo mensal, Visitas, Pendências e Horas. **Backup** em JSON na pasta "Init Intra — Backups" do Drive, guardado por 30 dias. |
| De 30 em 30 min | **Backups dos clientes:** e-mails do rótulo "Backups" do Gmail viram o status de cada rotina monitorada; falha ou silêncio além do limite abre pendência. |
| De 15 em 15 min | **Triagem de e-mail:** e-mail de cliente no rótulo "Pendências" vira pendência já preenchida (assunto, descrição, tipo, prioridade, categoria). |

Detalhes:
- **Lembretes da agenda:** no Google, lembrete de evento é pessoal. Os avisos de 30 e 7 dias e do dia continuam saindo por e-mail (`avisos-prazo`). Quem quiser também pode ligar as notificações da agenda "Vencimentos Init" nas próprias configurações do Google Agenda.
- **Domínio:** escreva o domínio na descrição ou nas observações do vencimento, por exemplo "Domínio cliente.com.br". Se não houver domínio, o erro fica registrado e nada é avisado.
- **Planilha:** dá para ligar no Looker Studio (Adicionar dados → Planilhas Google) e montar o painel da diretoria. Não edite a planilha à mão, porque ela é reescrita.
- **Backup:** não leva o token Milvus dos clientes nem o PIN dos operadores, e também não inclui as tabelas de credenciais e de sincronização. Os arquivos ficam no Drive da conta do robô: mesmo assim são dados de clientes, então compartilhe a pasta só com quem precisa.

### Instalar
1. Supabase (uma vez): rode a migration `059_vencimento_dominios.sql` e faça
   `supabase functions deploy robo --no-verify-jwt`. Ela usa os secrets que já existem.
2. No projeto do Apps Script: **+ → Script**, dê o nome `Robo` e cole
   [`tools/google-agenda-apps-script/Robo.gs`](tools/google-agenda-apps-script/Robo.gs).
   Se você colou o `appsscript.json`, cole a versão nova, que tem as permissões de Planilhas e Drive.
3. Rode **`instalarRobo`** e autorize as novas permissões (Planilhas e Drive). O log mostra os links da agenda, da planilha e da pasta de backup.
4. Opcional: para o Chat, crie um webhook no espaço (Apps e integrações → Webhooks) e salve na propriedade `CHAT_WEBHOOK`.
5. Para conferir o resumo sem mandar e-mail, rode `testarResumo`.

## Backups dos clientes por e-mail

1. No Gmail da conta do robô, crie um filtro para os e-mails dos backups (remetente do Veeam, Acronis, NAS…) com a ação **Aplicar o marcador "Backups"**. O robô cria o marcador sozinho na primeira execução.
   E-mails que chegam em outra caixa podem ser encaminhados para a do robô com um filtro de encaminhamento.
2. No site, abra o cliente → aba **Backups** → **+ Monitorar um backup**:
   - **Identificador:** um texto que aparece no remetente ou no assunto, por exemplo o nome do job ("Job SRV-ACME") ou o nome do servidor. Quando dois monitores servem, vence o identificador mais específico (o mais longo).
   - **Limite de horas:** quanto tempo sem e-mail ainda é normal. Para backup diário, 48 h é um bom valor.
3. A cada 30 minutos o robô lê os e-mails novos. O status sai do assunto: falha > aviso > sucesso, em português ou inglês. Se o assunto não disser, o robô olha o começo do texto.
4. **Falha** no último e-mail, ou **nenhum e-mail** dentro do limite, abre uma pendência de prioridade alta (tipo Manutenção, canal Proativo, categoria Backup). Ela vai para o responsável do monitor; sem responsável, só os admins veem. Abre uma pendência por vez: só cria outra quando a anterior for fechada. Para parar de alertar, desmarque **Monitorando**.

## IA pelo Make (um cenário, três rotas)

Toda a IA do Intra passa por **um único cenário no Make**, chamado **"Init Intra — IA (briefing, triagem, relatório)"**. Não existe chave de IA no projeto: o Make usa o provedor de IA que já vem com ele (conexão "Make's AI Provider", modelo **GPT-5 mini**).

```
Custom webhook → Router → briefing   → Simple Text Prompt            → Webhook response (texto)
                        → triagem    → Extract → Transform to JSON   → Webhook response (JSON)
                        → relatorio  → Simple Text Prompt            → Webhook response (texto)
```

O Intra manda sempre `{ "tarefa": "briefing" | "triagem" | "relatorio", ... }` e o **Router escolhe a rota pelo campo `tarefa`** (filtro "Text equal"). Uma URL só, um secret só:

```bash
supabase secrets set IA_WEBHOOK_URL=<URL do Custom webhook>
supabase functions deploy robo --no-verify-jwt
supabase functions deploy ia-relatorio
```

Cada rota está descrita na seção da função que a usa: briefing abaixo, [triagem](#triagem-de-e-mail-make) e [relatório](#relatório-da-visita-com-ia-make).

**Por que um cenário só:** o plano Free da Make deixa **2 cenários ativos** e **1.000 operações por mês**. Um cenário com Router gasta um slot só, e o Router não consome operação — cada chamada custa 3 (webhook + IA + resposta), ou seja, cerca de **330 chamadas por mês** somando briefing, triagem e relatório. Se o limite apertar, o plano Core sobe para 10.000 operações. O consumo aparece em *Organization → Usage*.

**Modelo:** no provedor da Make, os modelos GPT-4o, GPT-4o mini e GPT-4.1 mini **não são liberados** (erro "Model not allowed"); use **GPT-5 mini**. Trocar o modelo é no módulo de IA de cada rota.

**Se o Make falhar**, nada quebra no Intra: o briefing sai só com os fatos, a pendência da triagem abre com o texto do próprio e-mail e o "Escrever com IA" avisa o técnico. O módulo **Webhook response** é obrigatório em cada rota — sem ele o Make responde "Accepted", que o Intra trata como falha.

## Briefing com IA (Make)

O e-mail "Seu dia" já traz, em cada visita, os fatos do cliente: últimas visitas, pendências abertas, vencimentos, dispositivos parados e backups. Com o Make, ele também traz um parágrafo da IA, que aparece no e-mail e no detalhe da visita no site.

A rota `briefing` recebe `{ "tarefa", "visita_id", "contexto" }` — `contexto` é o texto pronto — e responde com o parágrafo em texto puro. A IA é chamada uma vez por visita por dia, no e-mail de cerca de 8h. Se o Make demorar mais de 25 s ou falhar, o e-mail sai sem o parágrafo.

### Prompt
```text
Você ajuda técnicos de suporte de TI de uma empresa que atende pequenas e médias empresas.
Antes de uma visita técnica, leia os fatos do cliente abaixo e escreva um briefing curto para o técnico.

Regras:
- Português do Brasil, direto, no máximo 5 frases curtas ou 5 tópicos com hífen.
- Diga o que o técnico deve verificar ou aproveitar a visita para resolver: pendências atrasadas, backups com problema, dispositivos que pararam de comunicar, vencimentos próximos, algo que se repete nas últimas visitas.
- Se o motivo da visita tiver relação com algum fato (ex.: visita de rede e um switch trocado na última visita), aponte a relação.
- Use só os fatos abaixo. Não invente equipamentos, causas, nomes ou números. Se não houver nada relevante além do motivo, responda apenas: "Nada a destacar além do motivo da visita."
- Sem saudação, sem título, sem Markdown (nada de asteriscos ou #).

Fatos:
{{contexto}}
```

> Privacidade: os fatos (nomes de clientes, pendências e relatórios) passam pelo Make e pelo provedor da IA. Não vão senhas nem tokens.

## Triagem de e-mail (Make)

E-mail de cliente marcado com o rótulo **"Pendências"** no Gmail do robô vira pendência no Intra, já com assunto, descrição, tipo, prioridade e categoria preenchidos.

### Como funciona
1. No Gmail da conta do robô, marque o e-mail com o rótulo **Pendências** — na mão ou por um filtro (por exemplo, tudo que chega no endereço de suporte). O robô cria o rótulo sozinho na primeira execução.
2. De 15 em 15 minutos o robô (`roboPendenciasEmail`) manda ao Intra os e-mails novos do rótulo.
3. O Intra acha o cliente pelo **domínio do remetente** (campo *Domínio* da aba E-mail da ficha do cliente) e, se não achar, pelo **nome do cliente no remetente ou no assunto**. Domínio de e-mail grátis (gmail, hotmail, uol…) nunca casa cliente.
4. Com o cliente na mão, os fatos vão ao cenário do Make, que devolve a classificação. A pendência abre com canal **E-mail**, etiqueta `triagem-automatica`, o técnico do cliente como responsável, o solicitante do e-mail e o prazo de 1ª resposta pela prioridade (mesma regra do `js/sla.js`: 8h–18h, seg–sex).
5. O e-mail original (remetente, data e assunto) fica no fim da descrição, e o texto do corpo é o que a IA resumiu — vale conferir antes de responder ao cliente.

**Não abre pendência:** e-mail de quem não é cliente (aparece no log do Apps Script, para alguém olhar no Gmail) e e-mail que a IA marca como propaganda, aviso automático, cobrança ou agradecimento. É uma pendência por mensagem, mesmo que o robô reenvie o mesmo e-mail.

**Se o Make falhar ou estiver fora do ar**, a pendência abre com o assunto e o texto do próprio e-mail, prioridade Média e categoria Outro, com a etiqueta `sem-classificacao-ia`: o pedido do cliente não se perde.

**Prioridade crítica** a IA não dá sozinha — o SLA de 1 h fica para a equipe decidir, então o teto é Alta. Para liberar, mude `TRIAGEM_PRIORIDADE_MAX` em [`supabase/functions/robo/campo.ts`](supabase/functions/robo/campo.ts).

### A rota `triagem` no Make
Recebe `{ "tarefa", "email_id", "de", "assunto", "data", "trecho", "cliente" }` e responde um JSON com `assunto`, `descricao`, `categoria`, `prioridade`, `tipo`, `solicitante` e `ignorar`.

É o módulo **Extract information from text**: sete campos, os seis primeiros do tipo *Text* e `ignorar` como *Boolean*. A **descrição de cada campo é o que diz à IA as opções válidas** (as listas da migration 056) — é ali que se ajusta o critério, sem tocar no código. Depois vem **Transform to JSON** e o **Webhook response** com `Content-Type: application/json`.

O Intra confere tudo o que volta: categoria, prioridade e tipo fora das listas caem no padrão (Outro / Média / Suporte), então um ajuste malfeito no prompt não suja o banco.

No Apps Script, rode **`instalarRobo`** de novo depois de atualizar o `Robo.gs` (ele recria os gatilhos e inclui o de 15 minutos).

> Privacidade: o remetente, o assunto e os primeiros 2.000 caracteres do e-mail passam pelo Make e pelo provedor da IA.

## Relatório da visita com IA (Make)

No relatório da visita, o botão **✨ Escrever com IA** manda as anotações soltas do técnico (com o cliente, o motivo e os itens concluídos do checklist) e devolve o texto organizado para o cliente final: *Resumo*, *O que foi feito* e *Pendências e recomendações*. O técnico revisa e pode **Desfazer** — a IA nunca salva nada sozinha, e o botão só aparece para operador logado e online.

A rota `relatorio` recebe `{ "tarefa", "contexto" }` e responde o relatório em texto puro. O prompt está no módulo de IA do cenário; as regras que valem a pena manter: só o que está nas anotações (nada inventado), texto simples sem Markdown, termo técnico explicado entre parênteses na primeira vez, e **senha ou token que apareça nas anotações sai como `[credencial omitida]`**.

Limites e erros ficam na Edge Function [`ia-relatorio`](supabase/functions/ia-relatorio/index.ts): anotações de 10 a 6.000 caracteres, 60 s de espera, e mensagem clara no app se o Make demorar ou falhar. Nada é salvo nem registrado no log além dos tamanhos.

> Privacidade: as anotações do técnico passam pelo Make e pelo provedor da IA. O aviso no botão pede para não escrever senhas; se escrever, a IA troca por `[credencial omitida]`, mas o texto original já passou pelo caminho.

## No site

- **Saúde do cliente (0 a 100):** a cor do cliente, o resumo, a ficha e o painel "Clientes em risco" passam a considerar também vencimentos, backups, dispositivos que pararam de comunicar com o Milvus (mais de 7 dias, medido na última sincronização do inventário) e tempo sem visita, além das pendências. O motivo de cada desconto aparece embaixo da nota.
- **Rota de hoje** (página Visitas, e link no "Seu dia"): suas visitas do dia, em ordem, numa rota do Google Maps.
  - **Preencha o endereço na ficha dos clientes.** Sem endereço, o Maps procura pelo nome do cliente.
- **📍 Cheguei / 🚪 Saí** no detalhe da visita: grava o horário (sem localização). O "Saí" lança as horas no cliente (origem "Visita").
- **Etiquetas QR:** no cliente → Inventário → **🏷️ Etiquetas QR** (folha A4 3 × 7, como a Pimaco A4356/6180; imprima em 100%), ou no menu ⋯ de um equipamento em conserto. O QR abre o Intra no equipamento (depois do login), com atalho para abrir uma pendência.

### Instalar (Supabase + robô)
1. Rode a migration `060_campo_backups_briefing.sql` e faça `supabase functions deploy robo --no-verify-jwt`.
2. No Apps Script, cole o `Robo.gs` novo (que agora inclui `roboBackupsEmail`), cole também o `appsscript.json` se você o usa (ele agora pede acesso ao Gmail), rode **`instalarRobo`** de novo e autorize.

## Limites

- O Apps Script de contas Workspace tem 6 h/dia de execução por acionador. Cada execução leva poucos segundos, o que dá folga.
- Cada execução envia até 200 visitas. Uma carga inicial grande termina em alguns minutos.
