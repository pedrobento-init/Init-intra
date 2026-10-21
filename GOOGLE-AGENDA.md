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

## Limites

- O Apps Script de contas Workspace tem 6 h/dia de execução por acionador. Cada execução leva poucos segundos, o que dá folga.
- Cada execução envia até 200 visitas. Uma carga inicial grande termina em alguns minutos.
