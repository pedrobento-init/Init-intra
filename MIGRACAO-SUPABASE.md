# Migrar o Supabase para outro projeto (ex.: Canadá → São Paulo)

Não existe botão para trocar a região de um projeto. O caminho é criar um
projeto novo na região certa e copiar tudo para ele. Este roteiro usa o script
[`tools/migrar-supabase.ps1`](tools/migrar-supabase.ps1) para a parte do banco e
lista o que o script **não** cobre.

> **Antes de migrar, meça.** A distância até o banco é só uma das causas
> possíveis de lentidão. Confira primeiro se o Realtime da `emails_triagem` está
> ligado (migration `067`) e quantos segundos leva uma mensagem. Migrar é um
> trabalho de várias horas, com janela de parada.

> **Este roteiro não foi executado de ponta a ponta por quem o escreveu.** O
> script foi escrito sem acesso a nenhum dos dois bancos. Faça a primeira
> rodada como ensaio, num projeto novo vazio, antes do dia da virada.

## 0. Pré-requisitos

- **Região do projeto novo:** painel → Settings → General → Region deve ser
  `South America (São Paulo)`. Se não for, pare aqui.
- **Docker Desktop** rodando (o script usa a imagem `postgres:17`, que traz
  `pg_dump`, `pg_restore` e `psql`; nada é instalado no Windows).
- **Supabase CLI** para funções e secrets (`npm i -g supabase` ou `scoop install supabase`),
  com `supabase login` feito na conta que enxerga os dois projetos.
- **String de conexão do pooler** dos dois projetos (painel → botão **Connect** →
  _Session pooler_, com a senha do banco). A conexão direta é só IPv6 e costuma
  falhar em redes domésticas.
- **Um backup do projeto antigo** antes de tudo (painel → Database → Backups).

## 1. Ensaio (sem parar nada)

Na raiz do repositório, no PowerShell:

```powershell
.\tools\migrar-supabase.ps1
```

Etapa `exportar` (padrão): **só lê** o projeto antigo e grava em `.\migracao\`
(pasta ignorada pelo Git, com dados reais: não envie a ninguém). Depois:

1. Abra `migracao\extensoes.txt` e **habilite as mesmas extensões** no projeto
   novo (Database → Extensions). Sem isso a importação falha no meio e desfaz
   tudo, o que é seguro, mas atrapalha.
2. Confira `migracao\contagem-antigo.csv` (linhas por tabela e total de usuários).
3. Crie o projeto novo **vazio**. Não rode nenhuma migration nele: o dump traz o
   esquema inteiro, como está hoje (as migrations deste projeto foram aplicadas
   à mão e o banco é a fonte da verdade).

```powershell
.\tools\migrar-supabase.ps1 -Etapa importar
.\tools\migrar-supabase.ps1 -Etapa conferir
```

A importação pede que você digite `MIGRAR`, recusa um projeto novo que já tenha
tabelas e roda numa transação única: se algo falhar, nada fica pela metade.
Se o ensaio der certo, **apague o projeto de ensaio ou esvazie-o** antes da
virada real, e repita tudo no dia.

## 1.1 Permissões (obrigatório depois do importar)

O dump **não** reproduz as permissões de `anon` e `authenticated`. Todo projeto
Supabase novo dá `ALL` (inclusive `TRUNCATE`, que ignora o RLS) a esses dois
papéis em toda tabela criada, e as migrations deste projeto tiraram isso no
banco antigo. Sem corrigir, o projeto novo fica **mais aberto** que o antigo.
Foi o que o `comparar` achou no ensaio.

```powershell
.\tools\migrar-supabase.ps1 -Etapa permissoes
```

Lê as permissões do projeto antigo (somente leitura) e, depois de você digitar
`MIGRAR`, aplica no novo numa transação só: tira tudo de `anon` e `authenticated`
em tabelas, sequências e funções (e o `EXECUTE` de `PUBLIC` nas funções) e devolve
exatamente o que o antigo permitia. Também recria as **policies do
`storage.objects`**, que o dump não leva. Repetir é seguro.

Depois, `-Etapa comparar` tem de dizer que as permissões batem. As únicas
diferenças aceitáveis são as que você sabe explicar (por exemplo, uma migration
aplicada só de um lado).

## 2. O que o script não faz (e você precisa fazer)

### 2.1 Storage

Os dumps não trazem os arquivos. Os buckets são recriados pela importação, mas
vazios. Copie os arquivos dos buckets (anexos) do projeto antigo para o novo
(painel → Storage, ou com `supabase storage cp`, que baixa de um projeto e
sobe no outro) e confira a contagem de arquivos. As **policies do Storage** ficam no schema `storage`, que o dump não leva:
a etapa `permissoes` (seção 1.1) as recria.

### 2.2 Edge Functions

```powershell
supabase functions deploy --project-ref <REF_NOVO>
```

Publica as 22 funções de `supabase/functions/` usando o `verify_jwt` de cada uma
no `supabase/config.toml` (o `whatsapp` e as que se autenticam por segredo
próprio ficam com `verify_jwt = false`). Rode `npx vitest run tests/edge-functions`
antes: o contrato do `verify_jwt` é trancado por teste.

### 2.3 Secrets

Os valores **não podem ser lidos** do projeto antigo: tire-os de onde você os
guardou. Crie o arquivo `.env.migracao` (ignorado pelo Git) com um `NOME=valor`
por linha e rode:

```powershell
supabase secrets set --project-ref <REF_NOVO> --env-file .env.migracao
```

Nomes usados hoje (os `SUPABASE_*` o Supabase cria sozinho no projeto novo):

| Grupo       | Secrets                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WhatsApp    | `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `WHATSAPP_WEBHOOK_TOKEN`, `WHATSAPP_BOT_ATIVO`                                                                                                                          |
| E-mail      | `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM`                                                                                                                                                                         |
| Milvus      | `MILVUS_API_TOKEN`, `MILVUS_API_URL`, `MILVUS_DEFAULT_TECNICO`, `MILVUS_DEFAULT_MESA`, `MILVUS_DEFAULT_SETOR`, `MILVUS_DEFAULT_CATEGORIA_PRIMARIA`, `MILVUS_DEFAULT_CATEGORIA_SECUNDARIA`, `MILVUS_DEFAULT_CATEGORIA_ID` |
| Push        | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (**use as mesmas**: trocar invalida as assinaturas de notificação já feitas)                                                                                                     |
| Agenda e IA | `AGENDA_SYNC_SECRET`, `AGENDA_SHARED_CAL`, `IA_WEBHOOK_URL`, `STUDIO_BRIEFING_SECRET`, `BRIEFING_PROVIDER`                                                                                                               |
| Outros      | `AVISOS_CRON_SECRET`, `APP_URL`                                                                                                                                                                                          |

### 2.3.1 Auth

Configurações de Auth **não** vêm no dump: Site URL, Redirect URLs, provedores,
SMTP e templates de e-mail. Copie-os à mão (Authentication → URL Configuration e
Providers). As senhas dos usuários migram junto; as **sessões abertas** não, e
todo mundo precisa entrar de novo depois da virada.

### 2.4 Vault e agendamentos (pg_cron)

**Nada disto vai no dump** (vivem nos schemas `vault` e `cron`), e o banco usa os
dois. Habilite `pg_cron` e `pg_net` no projeto novo (Database → Extensions)
**antes** de começar.

**Segredos do Vault.** O projeto antigo guarda três, por nome:

| Nome                 | Para quê                                                                                                                                        | Valor no projeto novo                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `client_secrets_key` | Chave que cifra a tabela `client_secrets` (migration 043). **Tem de ser a mesma**: com outra, os segredos copiados no dump ficam indecifráveis. | O mesmo valor do antigo                                                  |
| `avisos_cron_secret` | Cabeçalho `x-cron-secret` dos agendamentos. Tem de bater com o secret `AVISOS_CRON_SECRET` das Edge Functions.                                  | O mesmo valor do antigo                                                  |
| `project_url`        | Base da URL que os agendamentos chamam.                                                                                                         | **O endereço novo**: `https://<REF_NOVO>.supabase.co` (sem barra no fim) |

Leia os dois primeiros no SQL Editor do projeto **antigo** e copie direto de lá
para o do projeto **novo**. Nunca cole esses valores em chat nem em arquivo
versionado:

```sql
select name, decrypted_secret from vault.decrypted_secrets
 where name in ('client_secrets_key', 'avisos_cron_secret') order by name;
```

No SQL Editor do projeto **novo**:

```sql
select vault.create_secret('<VALOR_DA_CHAVE>',  'client_secrets_key');
select vault.create_secret('<VALOR_DO_SEGREDO>', 'avisos_cron_secret');
select vault.create_secret('https://<REF_NOVO>.supabase.co', 'project_url');
```

Confira que a leitura funciona, sem imprimir o valor:

```sql
select name, length(decrypted_secret) as tamanho from vault.decrypted_secrets order by name;
```

**Agendamentos.** O projeto antigo tem quatro, e os comandos leem o Vault pelo
nome, então só `project_url` muda. Depois de importar o esquema (a função
`public.chamados_sem_interacao()` vem no dump), crie-os no projeto **novo**:

```sql
select cron.schedule('avisos-prazo', '0 11 * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/avisos-prazo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);

select cron.schedule('avisos-enviados-limpeza', '30 11 * * 0',
  $job$ delete from public.avisos_enviados where sent_at < now() - interval '90 days' $job$);

select cron.schedule('chamados-sem-interacao', '17 * * * *',
  $job$ select public.chamados_sem_interacao() $job$);

select cron.schedule('relatorio-visitas-mensal', '0 11 1 * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/relatorio-visitas-mensal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avisos_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
```

Estes quatro são os de hoje (`cron.job` do projeto antigo). Eles repetem as
migrations `051`, `078` e `080`; se uma delas mudar, ajuste aqui também. Confira
com `select jobname, schedule, active from cron.job order by jobname;`.

**Desligue os do projeto antigo na virada**, ou o aviso de prazo e o relatório
mensal saem duas vezes (um de cada projeto):

```sql
select cron.unschedule(jobname) from cron.job;
```

Robôs externos (Apps Script, n8n, Make) que chamam as funções também precisam do
endereço novo.

### 2.5 Chave pública do projeto novo (`sb_publishable_...`)

Projetos Supabase criados recentemente podem vir com as chaves antigas (`anon` e
`service_role`, as que começam com `eyJ`) **desativadas**: uma `eyJ...` válida
responde `401 Invalid API key`. Se for o caso do projeto novo, use a chave
**publishable** (`sb_publishable_...`, Settings → API Keys → aba _Publishable
and secret API keys_) em todo lugar que hoje recebe a `anon`:

- `js/config.js` local e a variável `SUPABASE_ANON_KEY` da Vercel (o app só
  repassa o texto ao `createClient`; o formato novo é aceito);
- qualquer robô, Apps Script, n8n ou Make que chame o Supabase com a `anon`.

**Nunca** use a `sb_secret_...` no navegador. Teste cada chamador externo: uma
Edge Function com `verify_jwt = true` espera o JWT de um usuário logado, e a
chave publishable não é um JWT. As que se autenticam por segredo próprio já
estão com `verify_jwt = false` no `supabase/config.toml`.

Para conferir se o projeto aceita a chave, sem abrir o navegador:

```powershell
$t = Get-Content js\config.js -Raw; $null = $t -match "anonKey:\s*'([^']+)'"; $k = $Matches[1]; try { (Invoke-WebRequest -Uri 'https://<REF_NOVO>.supabase.co/auth/v1/settings' -Headers @{ apikey = $k } -UseBasicParsing).StatusCode } catch { $_.ErrorDetails.Message }
```

`200` = aceita. Um erro de texto diz o motivo.

## 3. Virada

Escolha um horário de pouco uso e avise a equipe.

1. **Pare as escritas:** desligue o webhook do WAHA ou pare o contêiner
   (`docker compose stop waha`) e peça para ninguém usar o Intra.
2. Rode **exportar de novo** (para pegar o que mudou desde o ensaio), depois
   **`-Etapa recarregar`** (esvazia os dados e os usuários do projeto novo e carrega
   os frescos, sem tocar no esquema nem nas permissões) e **conferir**. Se o projeto
   novo estiver vazio de verdade (nunca importado), use `importar` e `permissoes`
   em vez de `recarregar`. Só siga se o `conferir` mostrar tudo `OK`.
3. Storage, funções e secrets (seção 2).
4. **Troque os endereços** (e a chave pública, ver abaixo), nesta ordem:
   - Vercel → Settings → Environment Variables: `SUPABASE_URL` e
     `SUPABASE_ANON_KEY` (o `tools/build-config.js` as lê no deploy) e faça
     um redeploy.
   - `supabase/config.toml`: o `project_id`, se estiver nele.
   - Webhook do WAHA: `https://<REF_NOVO>.supabase.co/functions/v1/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>`
     e o secret `WAHA_BASE_URL` no projeto novo.
   - Robôs e integrações externas que apontavam para o endereço antigo.
5. Compare o estado dos dois bancos: `.\tools\migrar-supabase.ps1 -Etapa comparar`
   roda o `tools/check-schema.sql` (só SELECT, em modo somente leitura) nos dois
   projetos e lista as linhas diferentes de RLS, policies, grants, buckets e
   funções. Diferem de propósito as policies do `storage.objects`, que o dump
   não leva (seção 2.1). Esse é o teste mais importante.
6. Teste de ponta a ponta com um número de teste: mensagem entra na Caixa,
   responder chega no celular, login funciona, anexo abre.

## 4. Voltar atrás

O projeto antigo **não é alterado** por nada disto. Se a virada der errado,
volte as variáveis da Vercel e o webhook do WAHA para o endereço antigo e
reative o WAHA. Mantenha o projeto antigo vivo por alguns dias depois da virada
e só então pause-o.
