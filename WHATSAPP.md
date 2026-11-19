# WhatsApp — WAHA, n8n e Docker

Passo a passo para pôr o canal de WhatsApp no ar com
[WAHA](https://github.com/devlikeapro/waha) e conferir as duas pontas:
**mensagem do cliente chega no Intra** e **resposta do Intra chega no celular** —
pelo chamado (`whatsapp-responder`) ou direto da **Caixa de entrada**
(`conversa-responder`). O desenho do canal está no [README](README.md#estrutura) e
no cabeçalho das functions `supabase/functions/whatsapp/`,
`supabase/functions/whatsapp-responder/` e
`supabase/functions/conversa-responder/`.

> WAHA usa o WhatsApp Web como aparelho conectado. É uma API não oficial: use um
> número de teste antes do principal, pois automação indevida pode levar a
> restrições ou bloqueio do número.

## 1. Subir WAHA, n8n e PostgreSQL

O `compose.yaml` sobe os três serviços. O PostgreSQL é interno do n8n; o WAHA
guarda a sessão do WhatsApp em um volume próprio. As portas web ficam restritas
ao computador local.

1. Instale e abra o [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. No PowerShell, na raiz do projeto:

   ```powershell
   Copy-Item .env.example .env
   node -e "const c=require('crypto');for(const n of ['N8N_DB_PASSWORD','N8N_ENCRYPTION_KEY','WAHA_API_KEY','WAHA_DASHBOARD_PASSWORD'])console.log(n+'='+c.randomBytes(32).toString('hex'))"
   ```

3. Se o `.env` já existir, apenas acrescente as variáveis que faltarem. Substitua
   todos os valores `troque-por-...` pelos valores gerados, sem aspas. Guarde a
   `N8N_ENCRYPTION_KEY`: sem ela, o n8n não decifra suas credenciais após uma
   restauração.
4. Suba os serviços:

   ```powershell
   docker compose up -d
   docker compose ps
   ```

5. Abra [http://localhost:5678](http://localhost:5678) e crie o administrador
   do n8n no primeiro acesso.

Para parar sem apagar os dados, use `docker compose down`. Não use `down -v`:
isso apaga workflows, credenciais e a sessão do WhatsApp.

## 2. Conectar o número no WAHA

1. Abra [http://localhost:3000](http://localhost:3000).
2. Entre com usuário `admin` e a senha de `WAHA_DASHBOARD_PASSWORD`.
3. Crie ou inicie a sessão `default` e leia o QR Code no celular:
   **WhatsApp → Aparelhos conectados → Conectar um aparelho**.
4. Aguarde o status **WORKING**.

No n8n, chamadas ao WAHA usam a URL interna `http://waha:3000` e autenticação
por cabeçalho `X-Api-Key`, com o valor de `WAHA_API_KEY`. Por exemplo, o envio de
texto é `POST /api/sendText` com `{ "session": "default", "chatId":
"5511987654321@c.us", "text": "oi" }`.

## 3. Banco: migrations 075, 076, 077, 082 e 085 a 089

No **SQL Editor** do Supabase, nesta ordem (não use `supabase db push`):

1. Cole e rode `supabase/migrations/075_whatsapp_canal.sql`.
2. Cole e rode `supabase/migrations/076_whatsapp_conversas.sql`. O backfill
   comentado no cabeçalho não precisa rodar antes de chegar a primeira mensagem.
3. Cole e rode `supabase/migrations/077_whatsapp_desempenho.sql`. Sem ela o canal
   funciona, só que mais devagar e com um aviso no log.
4. Cole e rode `supabase/migrations/082_portal_conversas.sql`. É a que permite
   responder e anotar direto na caixa (`direcao`, `media` e o status
   `encerrado`). Sem ela o webhook ainda grava a mensagem, mas o portal não
   responde.
5. Cole e rode `supabase/migrations/085_whatsapp_bot_foto.sql`. É a do
   atendimento automático (estado do robô por número) e da foto de perfil do
   contato. Sem ela o webhook segue gravando a mensagem, só sem robô e sem foto.
6. Cole e rode `supabase/migrations/086_whatsapp_conversa_rica.sql`. É a dos
   recibos de entrega/leitura, da resposta citando e das reações (seção 12).
   Sem ela tudo continua funcionando, só sem esses recursos.
7. Cole e rode `supabase/migrations/087_whatsapp_filas.sql`: filas por
   departamento, "Pegar próximo" e rodízio (seção 13).
8. Opcional: cole e rode `supabase/migrations/088_whatsapp_automacao.sql`
   depois de publicar `conversa-encerrar` e `whatsapp-inatividade` (seção 14).
   É a da automação (horário, saudação, encerramento, pesquisa e
   inatividade). Sem ela tudo segue igual, só sem automação.
9. Cole e rode `supabase/migrations/089_whatsapp_etiquetas_contatos.sql`:
   etiquetas, contatos, atendimento ativo e painel (seção 15).
10. Confira com os `VERIFICAR` do cabeçalho de cada arquivo. O essencial:

```sql
select column_name from information_schema.columns
 where table_name = 'emails_triagem' and column_name in ('canal', 'telefone');
-- 2 linhas
select column_name from information_schema.columns
 where table_name = 'emails_triagem' and column_name in ('direcao', 'media');
-- 2 linhas
select relrowsecurity from pg_class where oid = 'public.whatsapp_conversas'::regclass;
-- true
select public.telefone_chave('(11) 98765-4321');
-- 1187654321
```

## 4. Tornar o WAHA acessível ao Supabase

As Edge Functions rodam na nuvem e **não alcançam `localhost`**. O serviço
`waha-tunnel` do `compose.yaml` cria um túnel HTTPS temporário para os testes.
Descubra o endereço com:

```powershell
docker compose logs waha-tunnel
```

Procure a linha `https://<nome>.trycloudflare.com` e use essa URL em
`WAHA_BASE_URL`. O endereço muda quando o túnel é recriado; nesse caso, atualize o
secret e o webhook. Para produção, use um túnel nomeado ou um servidor com endereço
fixo. Não exponha a API sem a `WAHA_API_KEY`, nem libere o painel publicamente sem
necessidade.

## 5. Secrets das Edge Functions

Gere um token longo e aleatório para o webhook:

```bash
openssl rand -hex 24
```

Depois grave os secrets (troque os valores):

```bash
supabase secrets set WAHA_BASE_URL=https://<endereco-publico-do-waha> WAHA_API_KEY=<mesma-chave-do-env> WAHA_SESSION=default WHATSAPP_WEBHOOK_TOKEN=<token-gerado>
```

Esses valores nunca vão para o Git nem para o `js/config.js`.

## 6. Publicar as functions

```bash
supabase functions deploy whatsapp
supabase functions deploy whatsapp-responder
supabase functions deploy conversa-responder
supabase functions deploy conversa-encerrar
supabase functions deploy whatsapp-inatividade
```

O `supabase/config.toml` deixa `verify_jwt = false` no `whatsapp` (quem chama é o
WAHA, sem JWT) e no `whatsapp-inatividade` (quem chama é o `pg_cron`, com
`x-cron-secret`), e `true` nas outras três (quem chama é o app, com o login do
operador). As duas últimas são da automação (seção 14).

## 7. Testar a entrada sem celular

Na raiz do projeto:

```bash
WHATSAPP_WEBHOOK_TOKEN=<token> node tools/whatsapp-simular.js --url https://<ref>.supabase.co/functions/v1/whatsapp --texto "teste do simulador"
```

Esperado: `{"ok":true,"notas":0,"caixa":1,"sem_cliente":1}` e a mensagem na
**Caixa de entrada** do Intra, com canal WhatsApp e motivo "sem cliente". Com
`--token errado` a resposta tem de ser **401**.

## 8. Apontar o webhook do WAHA

Na configuração da sessão `default`, cadastre um webhook:

- **URL:** `https://<ref>.supabase.co/functions/v1/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>`
- **Eventos:** `message`, `message.ack` e `message.reaction` (os dois últimos
  são os recibos ✓✓ e as reações; precisam da migration 086 — sem ela o
  webhook responde 200 e ignora)
- **Tentativas:** 15, com intervalo inicial de 2 segundos

Não assine `message.any`: ele inclui as mensagens enviadas pelo próprio número. O
adaptador também ignora essas mensagens, grupos e eventos sem texto.

## 9. Cadastrar o celular como contato de um cliente

O webhook casa o remetente com o cliente pelo telefone. Em **Clientes**, abra um
cliente de teste e ponha o número do celular em **Responsáveis → Contato**, com
DDD. Com ou sem o 9 e o 55 tanto faz: a comparação normaliza.

Sem esse cadastro a mensagem ainda chega, mas cai como "sem cliente" na equipe
padrão (`init`).

## 10. Teste ponta a ponta

1. De outro celular, mande uma mensagem para o número conectado no WAHA.
2. No Intra, **Caixa de entrada**: a mensagem aparece com o nome do cliente.
3. Responda ali mesmo, em **Responder ao cliente**, e envie: a resposta chega no
   celular e aparece na conversa como saída. Não precisa abrir chamado.
4. Troque para **Nota interna (não envia)**: a nota entra no histórico e o
   celular não recebe nada.
5. **Encerrar conversa** tira a conversa de "Em atendimento" e a mantém em
   "Todas". Responda do celular: a mensagem reabre o atendimento.
6. Se o caso precisar de SLA, abra o chamado a partir da conversa. A triagem
   nunca abre chamado sozinha: quem decide é quem atende.
7. No chamado, escreva uma resposta e envie: ela chega no celular.
8. Responda do celular: a mensagem vira nota do solicitante no mesmo chamado.
9. Conclua o chamado e mande outra mensagem: ela volta para a caixa como pedido
   novo.

## 11. Atendimento automático e foto do contato

O webhook pode responder sozinho **só com o menu de departamentos** e atribuir a
conversa conforme a escolha. Ele nunca responde pergunta, só encaminha. A
regra mora em `supabase/functions/whatsapp/bot.ts`.

**Como funciona**

1. Número **sem chamado aberto** manda a primeira mensagem: recebe o texto de
   boas-vindas com `1 - Suporte Técnico`, `2 - Comercial` e
   `3 - Atendimento Poiesis`. Número com chamado aberto nunca recebe o menu.
2. A escolha é tolerante: aceita `2`, `2.`, `opção 2`, `dois`, `comercial`,
   `vendas`, `poiesis`. O que é ambíguo (`22`, `12`, `1 e 2`) **não** é
   adivinhado: o robô pergunta de novo uma vez e, na segunda resposta ilegível,
   passa para um humano (conversa sem departamento, com a nota dizendo isso).
   Quem já abre a conversa com `2` ou `comercial` pula o menu.
3. Escolhido o departamento, o robô responde "Estamos direcionando seu
   atendimento…" com o **protocolo** (`AAAAMMDD-NNNN`, data de Brasília mais
   quatro dígitos) e a conversa entra na caixa com a nota
   `Escolheu "Comercial" no atendimento automático · protocolo …`. As mensagens
   que o número mandou antes de escolher (o "oi") ganham a mesma equipe e nota.
4. Fora do expediente (segunda a sexta, 08h30–12h e 13h–17h30, horário de
   Brasília) a confirmação vem seguida do aviso de horário.
5. Depois de **12 horas sem mensagem** do número, a conversa é nova e o menu
   volta.

**Equipes.** Hoje os três departamentos caem na equipe `init`; o departamento
escolhido fica na nota. Quando Comercial e Poiesis tiverem equipe própria, troque
`EQUIPE_DO_SETOR` em `bot.ts` (suporte de cliente já cadastrado segue a equipe
do cliente).

**Ligar.** O robô vem **desligado**. Depois da migration 085, as `WAHA_*` já
configuradas e o deploy da function:

```bash
supabase secrets set WHATSAPP_BOT_ATIVO=1
```

Para desligar, `supabase secrets unset WHATSAPP_BOT_ATIVO`. Teste primeiro com o
número de teste (seção 10): **cada mensagem que o robô manda é uma mensagem a
mais saindo do número da empresa**, e a WAHA é API não oficial.

**Foto de perfil.** O webhook busca a foto do contato na WAHA
(`/api/contacts/profile-picture`), guarda em `whatsapp_conversas` e copia para a
linha da caixa; renova a cada 24 h porque a URL do CDN do WhatsApp expira. Quem
deixou a foto visível só para contatos fica sem foto e a tela mostra as
iniciais, como antes. Só URL `https` é aceita.

**Remetente por LID.** O WhatsApp novo identifica quem escreve por um ID interno
(`189721758162980@lid`), e não pelo telefone. O webhook converte para o telefone
pela própria WAHA (`GET /api/<sessão>/lids/<lid>` devolve `{"lid", "pn"}`)
antes de gravar, então a Caixa mostra o número real, o cliente casa pelo
telefone e as respostas saem para `<telefone>@c.us`. Quando a WAHA não conhece o
telefone (contato que o esconde), a mensagem entra na Caixa com o ID no lugar do
número, **sem resposta automática**, e o envio pelo Intra para essa conversa não
funciona. Sintoma de versão sem essa conversão: `No LID for user` nos logs do
WAHA e telefone comprido e estranho na Caixa.

**O que o robô diz** está em `bot.ts` (`TEXTO_BOAS_VINDAS`,
`textoDirecionando`, `TEXTO_FORA_DO_HORARIO`). Mexeu no texto, mantenha os três
números do menu na ordem: o teste `tests/whatsapp-bot.test.js` trava isso.

## 12. Conversa rica: recibos, citação, reações, emojis, áudio e busca

Com a migration 086 aplicada e os eventos `message.ack` e `message.reaction`
assinados no webhook (seção 8), a conversa na **Caixa de entrada** mostra:

- **Recibo** em cada resposta da equipe: relógio (enviando), ✓ (no servidor),
  ✓✓ cinza (entregue), ✓✓ azul (lida) e **!** vermelho (não entregue). Mensagem
  antiga, de antes da 086, fica sem recibo: a tela não inventa ✓.
- **Visto para o cliente**: abrir uma conversa não lida manda o "visto" ao
  WhatsApp (`/api/sendSeen`), e o cliente vê o ✓✓ azul do lado dele.
- **Responder citando**: passe o mouse na mensagem e use a seta. A resposta sai
  como "responder" no WhatsApp (`reply_to`) e a citação aparece na bolha. Quando
  o **cliente** responde citando, a citação também aparece.
- **Reações**: o rostinho ao lado da mensagem abre 👍 ❤️ 😂 😮 😢 🙏; clicar de
  novo na mesma tira a reação. A reação do cliente aparece embaixo da bolha.
- **Emojis** no composer e **gravação de áudio** pelo microfone (até 5 min). O
  Chrome grava em WebM e o envio pede ao WAHA para converter para nota de voz
  (`sendVoice` com `convert: true`); se a sua versão do WAHA não converter, o
  áudio chega como arquivo. O site precisa de permissão de microfone
  (`Permissions-Policy: microphone=(self)` no `vercel.json`).
- **Busca na conversa** (lupa no cabeçalho), com anterior/próxima.

Teste rápido: mande uma mensagem pelo Intra e veja o ✓✓ ficar azul quando o
celular abrir a conversa; reaja no celular com 👍 e veja a reação no Intra.

## 13. Filas e rodízio (migration 087)

Com volume, "quem clica em Assumir primeiro" vira disputa (dois respondendo o
mesmo cliente) ou abandono (cada um achando que o outro pegou). A 087 transforma
a Caixa em fila: a conversa espera no departamento até alguém pegar, ou o
rodízio entrega sozinho.

**Aplicar.** No SQL Editor, depois da 085: `supabase/migrations/087_whatsapp_filas.sql`
(confira com o `VERIFICAR` do cabeçalho). Depois, publique de novo a function
`whatsapp`. Sem a migration nada quebra: o webhook grava a mensagem como antes e
deixa no log `migration 087 não aplicada`; na Caixa, o "Pegar próximo" avisa que
falta a migration.

**Na fila** é a conversa com mensagem do cliente pendente e **ninguém
responsável no ciclo aberto**. Encerrar ou descartar fecha o ciclo: se o mesmo
número escrever de novo, a conversa volta para a fila em vez de cair em quem
atendeu da última vez (que pode estar de folga ou ter saído). Enquanto o ciclo
está aberto, as mensagens novas herdam o responsável.

**Na Caixa** (com WhatsApp ou Todos os canais escolhidos):

- chips por departamento (Suporte, Comercial, Poiesis, Sem departamento), com o
  número de conversas **na fila** de cada um; o departamento vem da escolha no
  menu do atendimento automático (seção 11);
- **Na fila**: mostra só as conversas sem responsável;
- **Pegar próximo**: a conversa mais antiga da fila vai para você. Com um
  departamento escolhido, pega daquela fila; em "Todos", dos departamentos que
  você atende mais as sem departamento. Quem decide é a função
  `whatsapp_pegar_proximo`, no banco, com trava por conversa: dois cliques ao
  mesmo tempo nunca pegam a mesma. O limite de simultâneos **não** vale aqui —
  pegar é decisão de quem clicou;
- **Disponível / Em pausa**: em pausa, o rodízio não manda conversa nova para
  você (vale para este aparelho);
- **Configurar filas** (só admin): veja abaixo.

**Rodízio (opcional, por equipe).** Vem **desligado**. Em _Configurar filas_, o
admin liga o rodízio, define o limite de atendimentos simultâneos (padrão 5) e
marca quem atende e de quais departamentos (nenhum marcado = todos; limite
próprio vazio = o da equipe). Quem não foi marcado nunca recebe conversa
automaticamente, mesmo online. Com o rodízio ligado, quando uma conversa entra na
fila (depois de o cliente escolher o departamento, nunca no meio do menu), o
webhook entrega a quem:

1. está **online**: o app manda um sinal por minuto enquanto a aba está ativa;
   sem sinal há mais de 3 minutos, ausente (5 min sem mexer) ou em pausa, não
   conta;
2. atende o **departamento** da conversa (conversa sem departamento vale para
   qualquer atendente da equipe);
3. está **abaixo do limite** de atendimentos abertos;
4. tem **menos atendimentos abertos**; empate vai para quem recebeu conversa há
   mais tempo.

Ninguém assim: a conversa **fica na fila** para alguém pegar. A regra está em
`supabase/functions/whatsapp/filas.ts` (testada em `tests/whatsapp-filas.test.js`);
a leitura e a gravação, em `distribuicao.ts`.

**Onde fica cada coisa no banco.**

| O quê                              | Onde                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| Departamento da conversa           | `emails_triagem.departamento`                                         |
| Rodízio ligado e limite da equipe  | `whatsapp_filas_config` (uma linha por equipe; só admin grava)        |
| Quem atende, departamentos, limite | `whatsapp_atendentes` (só admin grava a configuração)                 |
| Sinal de vida do operador          | `whatsapp_atendentes.visto_em`, gravado por `whatsapp_atendente_ping` |

**Quando não distribui.**

| Sintoma                                 | Causa provável                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Log "migration 087 não aplicada"        | Rode a 087 e publique a function de novo.                                     |
| Conversa fica na fila com gente online  | Rodízio desligado, ninguém marcado em _Configurar filas_, ou todos no limite. |
| Operador online não aparece como online | Aba sem foco por mais de 5 min (ausente), em pausa, ou sem login no Supabase. |
| Conversa nova caiu em quem já atendia   | O ciclo anterior não foi encerrado: a mensagem herda o responsável.           |

## 14. Automação: horário, saudação, encerramento, satisfação e inatividade

Configuração **por equipe**, na **Caixa de entrada → Automação do WhatsApp**
(botão só para admin; a RLS da 088 também só deixa admin gravar). **Tudo vem
desligado**: equipe sem configuração não recebe mensagem automática nenhuma. A
regra está em `supabase/functions/whatsapp/automacao.ts`; quem lê o banco e
envia é `automacao-acoes.ts`. Mensagens automáticas aparecem na conversa como
"Atendimento automático".

**Horário de atendimento.** Faixas por dia da semana no horário de Brasília
(`08:30-12:00, 13:00-17:30`; `22:00-02:00` atravessa a meia-noite) e feriados
(`25/12` todo ano, `20/11/2026` só naquele dia). Fora do horário, a mensagem do
contato recebe o texto de "fora do expediente" **uma vez por período fechado**:
três mensagens no sábado recebem um aviso só; quem volta a escrever depois de um
expediente recebe de novo. Vale também para quem tem chamado aberto. Com o
horário da equipe ligado, o aviso fixo do menu de departamentos (seção 11) não
sai, para o cliente não receber dois avisos diferentes.

**Saudação.** Primeira mensagem de conversa nova (número novo, 12 h sem
mensagem ou conversa encerrada antes). Não sai quando o menu de departamentos
já respondeu nem para quem tem chamado aberto.

**Encerramento e pesquisa de satisfação.** Encerrar uma conversa de WhatsApp na
Caixa chama a function `conversa-encerrar`, que encerra também no servidor (só
na equipe da conversa) e manda o texto de encerramento e, se ligada, a
pesquisa. Nos textos, `{protocolo}` vira o protocolo que o robô deu à conversa
(sem protocolo, a linha que o cita sai). O padrão do encerramento já traz
`Protocolo: {protocolo}`; as duas mensagens vêm **desligadas** por padrão, e
quando nada sai o toast da Caixa diz o motivo. A pesquisa: **CSAT de 1 a 5** (nota do atendimento, não NPS, que mede a empresa e
pede 0 a 10 — difícil de responder num chat). A **primeira** mensagem depois do
encerramento, dentro do prazo configurado (24 h por padrão), é lida como nota:
aceita `5`, `nota 4`, `4/5`, `cinco`, `⭐⭐⭐`. Com nota, ela é gravada em
`whatsapp_avaliacoes`, o contato recebe o agradecimento e a conversa continua
encerrada. O que não é nota (`ainda está sem internet`) encerra a espera e entra
na Caixa como mensagem normal. A nota aparece no painel lateral da conversa
(**Satisfação**). Sem conexão, a Caixa encerra só localmente e nada é enviado.

**Inatividade.** Se a última mensagem foi de alguém da equipe e o contato não
responde em N minutos, sai um lembrete (opcional, uma vez por resposta da
equipe); em M minutos a conversa é encerrada com o aviso de encerramento por
inatividade (sem pesquisa). Mensagem do robô e nota interna não contam;
conversa ligada a chamado nunca é encerrada assim. Quem executa é a function
`whatsapp-inatividade`, chamada a cada 5 minutos pelo `pg_cron` que a 088
agenda, com no máximo 40 ações por rodada.

**Ligar.**

1. Publique `conversa-encerrar` e `whatsapp-inatividade` (seção 6).
2. O cron usa o mesmo segredo dos avisos de prazo: `AVISOS_CRON_SECRET` nos
   secrets das functions e `avisos_cron_secret`/`project_url` no Vault (já
   existem se a 051 está no ar). As `WAHA_*` são as da seção 5.
3. Rode a migration 088 no SQL Editor e confira o `VERIFICAR` do cabeçalho.
4. Na Caixa, como admin, abra **Automação do WhatsApp**, escolha a equipe,
   ligue o que quiser e salve. Vale a partir da próxima mensagem (até 30 s de
   cache).

Teste a cron na mão pelo SQL Editor, como no cabeçalho da 080, trocando a URL
por `/functions/v1/whatsapp-inatividade`: sem equipe com inatividade ligada a
resposta é `{"ok":true,"ativo":false}`.

## 15. Etiquetas, contatos, atendimento ativo e painel

**Banco.** Rode `supabase/migrations/089_whatsapp_etiquetas_contatos.sql` no SQL
Editor, depois da 088, e confira com os `VERIFICAR` do cabeçalho. Ela cria
`whatsapp_etiquetas`, `whatsapp_conversa_etiquetas` e `whatsapp_contatos` (RLS
por equipe, no realtime) e `whatsapp_envios_ativos` (sem policy: só o servidor).
Sem a 089 a Caixa segue igual, só sem etiquetas e nomes editados, e o envio
ativo recusa tudo com `migration_missing` (503).

**Etiquetas.** Na conversa da Caixa, **Ações → Etiquetas** marca e desmarca as
etiquetas da equipe e cria novas (nome até 40 caracteres, cor de uma paleta de
oito). A etiqueta é da **conversa** (telefone normalizado + equipe), não da
mensagem: continua lá quando o cliente manda a próxima. Aparece no item da
lista e no cabeçalho, e o seletor ao lado dos chips de canal filtra a lista
(as contagens das abas seguem o filtro). Editar e apagar: **Contatos do
WhatsApp → Etiquetas**; apagar tira a etiqueta de todas as conversas.

**Contatos do WhatsApp** (menu lateral) lista quem já escreveu para a empresa,
por equipe: nome, telefone, cliente vinculado, etiquetas e última conversa, com
busca e filtro por etiqueta. **Abrir conversa** leva para a Caixa; **Editar
nome** troca o nome de exibição para a equipe toda (em branco volta ao nome do
perfil do WhatsApp) — a Caixa passa a mostrar esse nome.

**Iniciar conversa** (atendimento ativo) chama a function `whatsapp-iniciar`:

```bash
supabase functions deploy whatsapp-iniciar
```

O servidor só aceita telefone de **cliente cadastrado da equipe** (dono ou
responsável; admin vale para qualquer equipe) ou de **quem já escreveu** e cuja
conversa a equipe enxerga na Caixa. Qualquer outro número dá 403
(`not_allowed_number`) sem tocar na WAHA — a trava da 076 continua valendo.
Antes de mandar, pergunta à WAHA se o número tem WhatsApp
(`/api/contacts/check-exists`; 422 `not_on_whatsapp` se não tiver). Limite: **20
conversas iniciadas por operador e 60 por equipe na última hora** (429
`rate_limited` / `team_rate_limited`); a tentativa conta mesmo se a WAHA
falhar. O cliente vê o nome de quem escreveu, como nas respostas. O envio
**não** entra em `whatsapp_conversas`: até o contato responder, nova mensagem
ativa passa de novo pela function. Se o contato escreveu nas últimas 24 h, a
tela manda responder pela conversa em vez de iniciar outra.

> Mensagem que a pessoa não espera é o motivo mais comum de denúncia e bloqueio
> do número, e a WAHA é API não oficial. Use para retorno de visita e aviso de
> chamado, nunca para campanha. Os limites ficam em
> `supabase/functions/whatsapp-iniciar/index.ts` (`LIMITE_OPERADOR_HORA`,
> `LIMITE_EQUIPE_HORA`).

**Painel de atendimento** (menu lateral) calcula tudo de `emails_triagem`, só
WhatsApp, respeitando a equipe (admin pode escolher a equipe), com período de
hoje, 7, 30 ou 90 dias:

- **Agora:** conversas abertas, aguardando resposta (a última fala é do
  cliente), na fila sem atendente e a maior espera.
- **No período:** tempo médio de 1ª resposta, tempo médio de atendimento,
  atendimentos (e quantos a empresa iniciou), sem resposta, conversas por
  atendente e mensagens recebidas por dia e por hora.

Regras: um atendimento começa na mensagem do cliente e termina ao **encerrar** a
conversa ou depois de **12 h sem mensagem** (aí o fim é a última mensagem). A 1ª
resposta é a primeira **saída escrita por gente**: nota interna e atendimento
automático não contam. Conversa descartada não entra nas médias. A avaliação de
satisfação aparece quando quem guarda as notas registra a fonte com
`wpainelRegistrarAvaliacoes(fn)` (em `js/whatsapp-painel.js`); sem ela, o
bloco não aparece.

## Quando algo não funciona

Os logs ficam no painel do Supabase: **Edge Functions → whatsapp** (ou
`whatsapp-responder`, `conversa-responder`) **→ Logs**. Os logs locais do WAHA
aparecem com `docker compose logs waha`.

| Sintoma                                 | Causa provável                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Nada chega e não há log                 | URL do webhook errada no WAHA, sessão sem `WORKING` ou evento `message` não assinado.          |
| Log com 401                             | O `token=` da URL não bate com `WHATSAPP_WEBHOOK_TOKEN`.                                       |
| 200 com `caixa: 0` em mensagem de texto | O payload não é um evento `message` com `payload.body`, `payload.from` e `payload.id`.         |
| Erro `column "canal" does not exist`    | A migration 075 não foi aplicada.                                                              |
| Erro `column "direcao" does not exist`  | A migration 082 não foi aplicada; a mensagem ainda entra, mas o portal não responde.           |
| Mensagem cai como "sem cliente"         | O telefone não está cadastrado ou está em dois clientes diferentes.                            |
| Envio: `missing_credentials` (500)      | Faltou `WAHA_BASE_URL` ou `WAHA_API_KEY` nos secrets.                                          |
| Envio: `provider_error` (502)           | Chave errada, sessão desconectada ou WAHA recusou o envio.                                     |
| Envio: `provider_unreachable` (502)     | `WAHA_BASE_URL` está inacessível; `localhost` não funciona para a Edge Function.               |
| Envio: `not_whatsapp_contact` (422)     | A 076 não foi aplicada, ou esse número nunca escreveu para a empresa.                          |
| Portal: `thread_not_found` (404)        | Linha antiga sem `thread_id` ou conversa de outra equipe; a RLS esconde a mensagem.            |
| Portal: `missing_credentials` (500)     | Faltou `WAHA_*` (WhatsApp) ou `GMAIL_*` (e-mail) nos secrets.                                  |
| Log "migration 077 não aplicada"        | Funciona assim, mas rode a 077 para evitar leitura de todos os clientes.                       |
| Log "passou de 30 mensagens por minuto" | O excesso foi descartado pelo limite do canal.                                                 |
| Envio: `pendencia_closed` (409)         | O chamado está encerrado. Reabra antes de responder.                                           |
| Automação: modal diz "migration 088"    | A 088 não foi aplicada; webhook e Caixa seguem sem automação.                                  |
| Encerrou, mas não saiu mensagem         | Encerramento/pesquisa desligados na equipe, `conversa-encerrar` não publicada ou sem `WAHA_*`. |
| Inatividade não age                     | Cron sem `AVISOS_CRON_SECRET`/Vault, ou a conversa tem chamado ligado.                         |
| Portal: `not_team_contact` (403)        | O número nunca escreveu para esta equipe (prova da 088, `whatsapp_conversa_equipes`).          |
| Envio ativo: `not_allowed_number` (403) | O número não é de cliente da equipe nem escreveu para ela.                                     |
| Envio ativo: `migration_missing` (503)  | A 089 não foi aplicada: sem contagem não há limite, então nada sai.                            |
| Envio ativo: `rate_limited` (429)       | Passou de 20 conversas iniciadas na última hora (60 por equipe). Espere.                       |
