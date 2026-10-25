# Atendimento por WhatsApp

Entrada de chamado pelo WhatsApp: o cliente manda mensagem para o número da
Init e vira chamado, com a mesma triagem do e-mail. **Teste**, não produção.

O que já existia e foi reaproveitado: `canal: 'whatsapp'` na lista da migration
056, a validação de listas fechadas da IA (`triagemDaIa`), o SLA de 1ª resposta
(`primeiraRespostaDue`), o corte de citação (`corpoLimpo`) e a conversa casada
(`email_thread_id`, migration 065). Nada de tabela nova, nada de migration
nova.

## Antes de tudo: o número

**A API oficial exige um número que NÃO esteja ativo no WhatsApp comum.** Se
você registrar seu celular pessoal, ele sai do WhatsApp do aparelho — você
perde o número como pessoal, e voltar atrás é trabalhoso.

Para testar, faça o contrário: a Meta dá um **número de teste grátis** ao criar
o app, e você cadastra o **seu celular como destinatário verificado**. Aí você
manda mensagem do seu celular **para** o número de teste, e o fluxo roda
inteiro sem arriscar nada.

> O número de teste tem limite de destinatários (poucos) e serve só para isso.
> Quando sair do teste, use um chip novo ou um número fixo da empresa.

## Passo a passo na Meta

1. **developers.facebook.com** → criar app do tipo **Business**.
2. Adicionar o produto **WhatsApp**. A Meta cria o número de teste e um
   WhatsApp Business Account (WABA).
3. Em **API Setup**, adicionar o seu celular em **To** (destinatário de teste)
   e confirmar o código que chega no WhatsApp.
4. Anotar o **App secret** (Configurações → Básico). É ele que assina cada POST.
5. Inventar um **verify token** — qualquer string sua, só para o handshake.

## Secrets no Supabase

```bash
supabase secrets set WHATSAPP_VERIFY_TOKEN=<a string que você inventou>
supabase secrets set WHATSAPP_APP_SECRET=<App secret do app na Meta>
supabase functions deploy whatsapp
```

`IA_WEBHOOK_URL` é o mesmo do robô, já configurado. Sem ele a triagem funciona
igual, só sem classificação da IA.

## Cadastrar o webhook

Na Meta, **WhatsApp → Configuration → Webhook**:

- **Callback URL**: `https://<project-ref>.supabase.co/functions/v1/whatsapp`
- **Verify token**: o mesmo do secret
- Clicar em **Verify and save** — a Meta faz um `GET` com `hub.challenge` e a
  function devolve o desafio. Falhou aqui, o token não bate.
- **Subscribe** no campo **messages**.

> **O passo que todo mundo esquece:** além de salvar o webhook, o WABA precisa
> estar inscrito no app. Sem isso a verificação passa e **nenhuma mensagem
> chega** — é o sintoma mais comum de "o webhook não dispara". Confira em
> Configuration que `messages` aparece como subscrito.

## Como testar

Mande uma mensagem do seu celular para o número de teste. Depois:

```bash
supabase functions logs whatsapp
```

A resposta traz `{ mensagens, abertas, notas, sem_cliente }`.

- **`abertas: 1`** → chamado aberto. Confira no Intra, canal WhatsApp.
- **`sem_cliente: ["+5511..."]`** → o telefone não casou com nenhuma ficha.
  Esperado no primeiro teste: ponha o seu número em **Dono** ou **Responsável**
  na ficha de um cliente e mande de novo.
- **`notas: 1`** → a conversa já tinha chamado aberto e a mensagem virou nota
  nele. É o comportamento certo: no WhatsApp as pessoas mandam cinco mensagens
  seguidas, e cada uma não pode virar um chamado.

## O que este teste faz e não faz

| Faz | Não faz |
| --- | --- |
| Mensagem de texto vira chamado | Áudio, imagem e documento — virariam chamado sem texto |
| Mensagem seguinte vira nota no chamado aberto | Responder pelo Intra (a janela de 24 h da Meta pede template aprovado) |
| Casa o cliente pelo telefone da ficha | Cadastrar cliente novo sozinho |
| Classifica pela IA do Make, como o e-mail | Mandar aviso automático de volta |

**Chamado fechado não recebe mensagem nova:** mensagem depois de concluir abre
chamado novo, igual ao e-mail. Ressuscitar o antigo esconderia o pedido do SLA.

## Segurança

Quem chama é a Meta, que não tem como mandar chave do Supabase — então a
function usa `auth: "none"` e autentica pela **assinatura HMAC do corpo**
(`X-Hub-Signature-256`), conferida **antes** de ler o payload. É o mesmo
desenho de um webhook de pagamento, e está travado em
`tests/edge-functions-guard.test.js`.

A comparação da assinatura é em tempo constante: com `===`, o tempo de resposta
revelaria quantos bytes do começo batem, e isso basta para forjar a assinatura
byte a byte.

`verify_jwt = false` no `config.toml` é obrigatório — com ele ligado a
plataforma barra a Meta antes de a function rodar.

## Casar o telefone

O `wa_id` chega como `5511999990000`; a ficha do cliente tem texto livre. A
comparação usa **DDD + os 8 últimos dígitos**, o que ignora o nono dígito dos
celulares — é o que faz cadastro antigo casar com número atual.

O preço: dois números do mesmo DDD que só diferem no nono dígito viram a mesma
chave. É raro, e quando não casa nada é inventado — vira `sem_cliente` e alguém
olha.
