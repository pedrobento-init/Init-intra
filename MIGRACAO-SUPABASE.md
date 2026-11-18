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

## 2. O que o script não faz (e você precisa fazer)

### 2.1 Storage

Os dumps não trazem os arquivos. Os buckets são recriados pela importação, mas
vazios. Copie os arquivos dos buckets (anexos) do projeto antigo para o novo
(painel → Storage, ou com `supabase storage cp`, que baixa de um projeto e
sobe no outro) e confira a contagem de arquivos. Confira também as **policies do Storage**
(`select * from pg_policies where schemaname = 'storage'` nos dois lados): elas
ficam no schema `storage`, que o dump não leva.

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

### 2.4 Agendamentos

Se o projeto antigo usa `pg_cron`, anote `select * from cron.job` e recrie no
novo. Robôs externos (Apps Script, n8n, Make) que chamam as funções precisam do
endereço novo.

## 3. Virada

Escolha um horário de pouco uso e avise a equipe.

1. **Pare as escritas:** desligue o webhook do WAHA ou pare o contêiner
   (`docker compose stop waha`) e peça para ninguém usar o Intra.
2. Rode **exportar de novo** (para pegar o que mudou desde o ensaio), esvazie ou
   recrie o projeto novo, **importar** e **conferir**. Só siga se o `conferir`
   mostrar tudo `OK`.
3. Storage, funções e secrets (seção 2).
4. **Troque os endereços**, nesta ordem:
   - Vercel → Settings → Environment Variables: `SUPABASE_URL` e
     `SUPABASE_ANON_KEY` (o `tools/build-config.js` as lê no deploy) e faça
     um redeploy.
   - `supabase/config.toml`: o `project_id`, se estiver nele.
   - Webhook do WAHA: `https://<REF_NOVO>.supabase.co/functions/v1/whatsapp?token=<WHATSAPP_WEBHOOK_TOKEN>`
     e o secret `WAHA_BASE_URL` no projeto novo.
   - Robôs e integrações externas que apontavam para o endereço antigo.
5. Rode `tools/check-schema.sql` no SQL Editor **dos dois projetos** e compare
   (RLS, policies, grants, buckets, funções). Esse é o teste mais importante.
6. Teste de ponta a ponta com um número de teste: mensagem entra na Caixa,
   responder chega no celular, login funciona, anexo abre.

## 4. Voltar atrás

O projeto antigo **não é alterado** por nada disto. Se a virada der errado,
volte as variáveis da Vercel e o webhook do WAHA para o endereço antigo e
reative o WAHA. Mantenha o projeto antigo vivo por alguns dias depois da virada
e só então pause-o.
