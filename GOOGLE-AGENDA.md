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

Toda a IA do Intra passa por **um único cenário no Make**, chamado **"Init Intra — IA (briefing, triagem, relatório, o que levar)"**. Não existe chave de IA no projeto: o Make usa o provedor de IA que já vem com ele (conexão "Make's AI Provider", modelo **GPT-5 mini**).

```
Custom webhook → Router → briefing   → Simple Text Prompt            → Webhook response (texto)
                        → triagem    → Extract → Transform to JSON   → Webhook response (JSON)
                        → relatorio  → Simple Text Prompt            → Webhook response (texto)
                        → levar      → Simple Text Prompt            → Webhook response (texto)
```

O Intra manda sempre `{ "tarefa": "briefing" | "triagem" | "relatorio" | "levar", ... }` e o **Router escolhe a rota pelo campo `tarefa`** (filtro "Text equal"). Uma URL só, um secret só:

```bash
supabase secrets set IA_WEBHOOK_URL=<URL do Custom webhook>
supabase functions deploy robo --no-verify-jwt
supabase functions deploy ia-relatorio
supabase functions deploy ia-levar
```

Cada rota está descrita na seção da função que a usa: briefing abaixo, [triagem](#triagem-de-e-mail-make), [relatório](#relatório-da-visita-com-ia-make) e [o que levar](#o-que-levar-com-ia-make).

**Por que um cenário só:** o plano Free da Make deixa **2 cenários ativos** e **1.000 operações por mês**. Um cenário com Router gasta um slot só, e o Router não consome operação — cada chamada custa 3 (webhook + IA + resposta), ou seja, cerca de **330 chamadas por mês** somando as quatro rotas. Se o limite apertar, o plano Core sobe para 10.000 operações. O consumo aparece em *Organization → Usage*.

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

### Responder ao cliente pela tela (migration 064)

O caminho de volta: no chamado aberto pela triagem, a caixa **"Enviar por e-mail para ..."** aparece abaixo do campo de texto, já marcada. A nota postada como **Resposta** vai para quem escreveu, **na mesma conversa de e-mail** — então a resposta cai na thread original dele, não numa mensagem solta.

- **Quem recebe não é escolha do app.** A tela manda só o `pendencia_id`; a function [`pendencia-responder`](supabase/functions/pendencia-responder/index.ts) lê o `solicitante_email` daquele chamado com a chave de serviço. É a mesma preocupação da `send-email` (a chave pública vai no site), com outro critério: lá, só operador ativo; aqui, só quem está no chamado.
- **Na mesma conversa** porque a triagem guarda o `Message-ID` do e-mail (`email_message_id`), que volta como `In-Reply-To`/`References`. E-mail antigo, anterior a esta mudança, não tem o cabeçalho guardado: a resposta sai assim mesmo, como conversa nova, e o aviso na tela diz isso.
- **Anotação interna nunca vira e-mail** — ao trocar para interna, a caixa some.
- **E-mail que não sai não desfaz a nota.** Ela já está salva quando o envio acontece; falha vira aviso, não perda do que o técnico escreveu.
- **Chamado sem `solicitante_email`** (aberto por telefone, por exemplo) não mostra a caixa.

Deploy: `supabase functions deploy pendencia-responder`. Usa os mesmos secrets da `send-email` (`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM` opcional) — sem secret novo.

### O que o Intra tira do e-mail antes de abrir o chamado

Um e-mail de resposta carrega a conversa citada embaixo e a assinatura de quem
escreveu. Isso ia cru para a IA e, sem IA, virava a descrição do chamado — que
terminava no meio de `Em qui., 22 de`, porque o corte de 600 caracteres caía
dentro do trecho citado. O `corpoLimpo` (em `supabase/functions/robo/campo.ts`)
corta, nesta ordem:

- **a conversa citada**, pelo marcador que o próprio programa de e-mail escreve
  (`Em ... escreveu:`, `On ... wrote:`, `-----Mensagem original-----`, o bloco
  `De:/Enviada em:` do Outlook, a régua de sublinhados, a primeira linha com `>`);
- **a assinatura**, pelo delimitador `-- ` do RFC 3676 ou por uma despedida
  (`Obrigado,`, `Atenciosamente`) seguida de bloco de contato curto — telefone,
  site ou e-mail. A despedida em si fica: é a última coisa que a pessoa escreveu.

A regra é **errar para menos**: despedida seguida de texto de verdade não é
assinatura, e se o corte não deixaria quase nada o texto original volta inteiro.
Um e-mail de duas linhas nunca vira um chamado vazio.

> Privacidade: isso também encolhe o que sai daqui — a conversa citada deixou de
> passar pelo Make e pelo provedor da IA.

### E-mail da própria Init não abre chamado

O `roboPendenciasEmail` varre a **conversa inteira** do rótulo (`th.getMessages()`),
então a nossa resposta ao cliente chegava como mensagem nova e abria um chamado
com o técnico como solicitante — e o botão **"Enviar por e-mail"** daquele chamado
devolveria a resposta para a própria Init.

A triagem agora descarta o e-mail cujo remetente é do domínio do `GMAIL_USER`
(subdomínios incluídos), antes de tocar no banco. **Não há secret novo**: o
domínio de casa sai da caixa que o robô já usa. Sem `GMAIL_USER`, ninguém é
barrado e o comportamento é o de antes. O log do Apps Script passa a contar
esses e-mails (`N da própria Init`).

A resposta do *cliente* na mesma conversa é tratada logo abaixo.


### Resposta do cliente cai no chamado que a conversa já abriu

O robô varre a conversa inteira, então a resposta do cliente chegava como
mensagem nova e abria **outro** chamado do mesmo assunto — quem atende ficava
com dois pela metade.

O `Robo.gs` passa a mandar `thread_id` (o `th.getId()`, id da **conversa**, não
o da mensagem), e a triagem guarda isso em `email_thread_id` (migration 065).
Toda mensagem seguinte da conversa procura um chamado **aberto** com esse id:

- **achou** → a mensagem vira **nota** nele, e nada de chamado novo. O
  `email_message_id` do chamado é atualizado para a mensagem mais recente, para
  a resposta da tela sair em cima dela e a conversa não desgrudar;
- **não achou, ou o chamado está fechado** → abre chamado novo, como antes.
  Resposta depois de concluir é pedido novo; ressuscitar o antigo esconderia
  isso do SLA e da fila.

A nota entra com **`visibility: "solicitante"`**, um valor novo. Só `"resposta"`
conta como 1ª resposta no SLA (`js/sla.js`, `slaNotaEhResposta`), então a fala
de quem pediu nunca marca que a gente respondeu — e isso é fail-closed: se
alguém esquecer deste caminho, o pior que acontece é não contar. No feed do
chamado ela aparece com o selo **✉ do solicitante**, não como 🔒 interna.

Essas mensagens **não passam pela IA**: a conversa já tem assunto, cliente e
prioridade, não há o que classificar — e é uma chamada a menos ao Make. O
preço é que uma resposta automática do cliente ("Obrigado pelo contato") vira
nota em vez de ser ignorada.

> Sem a migration 065 nada quebra: `email_thread_id` é optionalField, a busca
> falha em silêncio (fica no log da function) e a triagem volta a abrir um
> chamado por mensagem.


### A rota `triagem` no Make
Recebe `{ "tarefa", "email_id", "de", "assunto", "data", "trecho", "cliente" }` e responde um JSON com `assunto`, `descricao`, `categoria`, `prioridade`, `tipo`, `solicitante` e `ignorar`.

É o módulo **Extract information from text**: sete campos, os seis primeiros do tipo *Text* e `ignorar` como *Boolean*. A **descrição de cada campo é o que diz à IA as opções válidas** (as listas da migration 056) — é ali que se ajusta o critério, sem tocar no código. Depois vem **Transform to JSON** e o **Webhook response** com `Content-Type: application/json`.

O Intra confere tudo o que volta: categoria, prioridade e tipo fora das listas caem no padrão (Outro / Média / Suporte), então um ajuste malfeito no prompt não suja o banco.

No Apps Script, rode **`instalarRobo`** de novo depois de atualizar o `Robo.gs` (ele recria os gatilhos e inclui o de 15 minutos).

> Privacidade: o remetente, o assunto e os primeiros 2.000 caracteres do e-mail passam pelo Make e pelo provedor da IA.

## Quando o e-mail não vira chamado

Dois caminhos da triagem não abrem chamado, e antes os dois sumiam em silêncio:

| Motivo | O que aconteceu | O que fazer |
| --- | --- | --- |
| **Sem cliente** | O remetente não casou com ficha nenhuma: domínio fora do cadastro, ou Gmail/Hotmail pessoal — domínio público **nunca** casa, de propósito, porque o remetente pode ser qualquer um. | Cadastrar o cliente, ou pôr o domínio em `emails.domain` na ficha. |
| **A IA ignorou** | O Make devolveu `ignorar: true` — propaganda, aviso automático, agradecimento. | Conferir. Quando o Make erra, é aqui que o pedido real aparece. |

Agora os dois viram linha em `emails_triagem` (migration 066) e aparecem **no
topo da tela de Pendências**, numa caixa que some sozinha quando não há nada
pendente. Cada entrada traz dois botões: **Abrir chamado** (leva assunto,
corpo, remetente e a conversa do Gmail para o formulário) e **Descartar**.

Descartar não apaga: grava `status = 'descartado'` com quem decidiu e quando.
Apagar de verdade é só do admin. A linha é o registro de que um pedido chegou
— e sumir com registro de pedido é exatamente o defeito que isto conserta.

> **O cliente fica em branco ao abrir o chamado, de propósito.** O motivo de a
> entrada estar na caixa é ninguém saber de quem ela é; chutar poria o chamado
> no cliente errado, que é pior do que pedir para escolher.

Banco sem a 066 não quebra nada: a caixa não aparece e a triagem volta a
descartar como antes. Mas o robô tenta de novo a cada rodada, então aplicar a
migration recupera o que chegou nesse meio-tempo.

## O e-mail inteiro no chamado

A `descricao` é um resumo de 600 caracteres — a IA escreve nesse limite, e sem
IA o corte cai no meio da frase. O e-mail completo, já sem conversa citada e
sem assinatura, fica em `pendencias.email_corpo` (066) e aparece no detalhe do
chamado atrás de **"Ver o e-mail inteiro"**.

O botão só aparece quando há o que mostrar a mais: repetir o mesmo texto duas
vezes na tela é pior do que não ter botão.

O bloco de origem (`De:`, `Recebido em:`, `Assunto original:`) saiu do meio da
descrição e virou cartão. A separação é feita **na hora de desenhar**, não na
gravação — assim os chamados que já existem ficam apresentáveis também, sem
mexer em dado nenhum.

## Relatório da visita com IA (Make)

No relatório da visita, o botão **✨ Escrever com IA** manda as anotações soltas do técnico (com o cliente, o motivo e os itens concluídos do checklist) e devolve o texto organizado para o cliente final: *Resumo*, *O que foi feito* e *Pendências e recomendações*. O técnico revisa e pode **Desfazer** — a IA nunca salva nada sozinha, e o botão só aparece para operador logado e online.

A rota `relatorio` recebe `{ "tarefa", "contexto" }` e responde o relatório em texto puro. O prompt está no módulo de IA do cenário; as regras que valem a pena manter: só o que está nas anotações (nada inventado), texto simples sem Markdown, termo técnico explicado entre parênteses na primeira vez, e **senha ou token que apareça nas anotações sai como `[credencial omitida]`**.

Limites e erros ficam na Edge Function [`ia-relatorio`](supabase/functions/ia-relatorio/index.ts): anotações de 10 a 6.000 caracteres, 60 s de espera, e mensagem clara no app se o Make demorar ou falhar. Nada é salvo nem registrado no log além dos tamanhos.

> Privacidade: as anotações do técnico passam pelo Make e pelo provedor da IA. O aviso no botão pede para não escrever senhas; se escrever, a IA troca por `[credencial omitida]`, mas o texto original já passou pelo caminho.

## O que levar com IA (Make)

O "O que levar" da visita (migration 058) continua funcionando como sempre: as regras **palavras-chave → itens** (tabela `levar_regras`, tela "Regras do que levar") sugerem na hora, offline e sem custo, agora lendo o **motivo e as observações**. O botão **✨ Sugerir com IA**, no mesmo bloco do formulário, é a segunda opinião para a visita atípica — aquela em que o problema está descrito sem nenhuma palavra-chave ("não puxa papel", sem a palavra "impressora").

A rota `levar` recebe `{ "tarefa", "contexto" }` e responde **um item por linha**. Além do motivo e das observações, a Edge Function [`ia-levar`](supabase/functions/ia-levar/index.ts) monta o contexto com:

- as **3 últimas visitas concluídas** daquele cliente, com 300 caracteres de cada relatório — é assim que entra o "faltou conector RJ45 na visita passada";
- o **inventário ativo** do cliente (até 10 dispositivos: apelido, marca e sistema), que permite item específico como "toner da HP LaserJet M428";
- a **lista que o técnico já montou**, para a IA não repetir.

O que volta é tratado como sugestão: no máximo 6 itens, de 120 caracteres, sem numeração nem repetido, mesclados com `levarMescla` — **item que o técnico tirou não volta** e item já marcado continua marcado. Quem decide é ele.

O botão só aparece com operador logado e conexão (mesma regra do relatório). Sem cliente escolhido ainda, a IA trabalha só com o motivo e as observações; o cliente é lido do formulário no momento do clique, então trocar o cliente antes de clicar funciona.

> Privacidade: nome do cliente, motivo, observações, relatórios das últimas visitas e o inventário resumido passam pelo Make e pelo provedor da IA. IP, MAC e número de série do inventário não são enviados.

## No site

- **Saúde do cliente (0 a 100):** a cor do cliente, o resumo, a ficha e o painel "Clientes em risco" passam a considerar também vencimentos, backups, dispositivos que pararam de comunicar com o Milvus (mais de 7 dias, medido na última sincronização do inventário) e tempo sem visita, além das pendências. O motivo de cada desconto aparece embaixo da nota.
- **Rota de hoje** (página Visitas, e link no "Seu dia"): suas visitas do dia, em ordem, numa rota do Google Maps.
  - **Preencha o endereço na ficha dos clientes.** Sem endereço, o Maps procura pelo nome do cliente.
- **📍 Cheguei / 🚪 Saí** no detalhe da visita: grava o horário (sem localização). O "Saí" lança as horas no cliente (origem "Visita").
- **Etiquetas QR:** no cliente → Inventário → **🏷️ Etiquetas QR** (folha A4 3 × 7, como a Pimaco A4356/6180; imprima em 100%), ou no menu ⋯ de um equipamento em conserto. O QR abre o Intra no equipamento (depois do login), com atalho para abrir uma pendência.

### Instalar (Supabase + robô)
1. Rode a migration `060_campo_backups_briefing.sql` e faça `supabase functions deploy robo --no-verify-jwt`.
2. No Apps Script, cole o `Robo.gs` novo (que agora inclui `roboBackupsEmail`), cole também o `appsscript.json` se você o usa (ele agora pede acesso ao Gmail), rode **`instalarRobo`** de novo e autorize.

### Instalar a pasta do Drive automática (robô da noite)
Toda noite o robô preenche o link da pasta de quem tem planilha e não tem pasta (a pasta onde a planilha está), cria a pasta do cliente novo que não tem pasta nem planilha e confere as pastas vinculadas. A ficha mostra um selo discreto: ✅ verificada, ⚠️ sem acesso ou ⚠️ link inválido. Um link colocado por alguém nunca é trocado.
1. Rode as migrations `068_clients_drive_folder.sql` e `069_clients_drive_folder_status.sql`.
2. No drive compartilhado dos clientes, dê à conta que roda o robô o papel **Colaborador** (leitura não basta: ele cria pastas).
3. No Apps Script, em **Configurações do projeto → Propriedades do script**, crie `CLIENTES_ROOT_ID` com o ID da pasta raiz dos clientes (a parte do link depois de `/folders/`).
4. Cole o `Robo.gs` novo e rode **`instalarRobo`** de novo. Antes da primeira noite, rode **`testarPastas`**: ele mostra quantos clientes vai olhar e o nome de quem ganharia pasta, sem criar nada.
5. Faça `supabase functions deploy robo --no-verify-jwt`.

Limites da criação: só ganha pasta o cliente cadastrado a partir de 27/10/2026 (os antigos podem já ter pasta com outro nome); a pasta leva só o nome do cliente, então dois clientes com o mesmo nome dividem a mesma pasta.

## Limites

- O Apps Script de contas Workspace tem 6 h/dia de execução por acionador. Cada execução leva poucos segundos, o que dá folga.
- Cada execução envia até 200 visitas. Uma carga inicial grande termina em alguns minutos.
