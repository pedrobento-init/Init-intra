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

## Testar sem depender da Meta

**Para esta parte você não precisa da Meta ainda.** O `WHATSAPP_APP_SECRET` só
precisa ser o MESMO dos dois lados — function e simulador. Então, enquanto é
teste, pode ser uma string inventada por você; troque pelo App secret de
verdade quando for ligar o webhook da Meta.


Antes de existir app, número ou webhook, dá para exercitar a ponta inteira
(assinatura → triagem → chamado) com o simulador:

```bash
export WHATSAPP_APP_SECRET=<App secret do app na Meta>
node tools/whatsapp-simular.js --url https://<ref>.supabase.co/functions/v1/whatsapp \
  --de 5511999990000 --nome "Beatriz Rangel" --texto "O notebook não liga"
```

O segredo vai pelo **ambiente, nunca por argumento**: argumento fica no
histórico do shell e na lista de processos da máquina.

Outros modos:

```bash
# só o handshake de cadastro (o GET que a Meta faz ao salvar o webhook)
WHATSAPP_VERIFY_TOKEN=<seu token> node tools/whatsapp-simular.js --url <url> --verificar

# conferir que assinatura errada é recusada — tem de responder 401
node tools/whatsapp-simular.js --url <url> --assinatura errada

# imprimir payload e assinatura sem mandar nada (para colar num curl)
node tools/whatsapp-simular.js --mostrar --texto "teste"
```

Cada rodada sorteia um `id` de mensagem novo, porque a function guarda o id
para não abrir o mesmo chamado duas vezes — com id fixo, a segunda rodada não
faria nada e pareceria quebrada. Para testar justamente a repetição, passe
`--id wamid.FIXO` duas vezes: a segunda deve responder sem abrir nada.

> O simulador não é "mais ou menos" o formato da Meta:
> `tests/whatsapp-simular.test.js` joga o payload dele no parser de verdade
> (`mensagensDoWebhook`) e a assinatura no verificador de verdade
> (`assinaturaValida`). Se os dois divergirem, o teste quebra em vez de o
> simulador dar "tudo certo" numa coisa que a Meta de verdade não faria.


## O que este teste faz e não faz

| Faz | Não faz |
| --- | --- |
| Mensagem de texto vira chamado | Áudio, imagem e documento — virariam chamado sem texto |
| Mensagem seguinte vira nota no chamado aberto | Falar fora da janela de 24 h (pede template aprovado) |
| Casa o cliente pelo telefone da ficha | Cadastrar cliente novo sozinho |
| Classifica pela IA do Make, como o e-mail | Mandar aviso automático de volta |
| Responder pelo Intra, dentro da janela de 24 h | |

**Chamado fechado não recebe mensagem nova:** mensagem depois de concluir abre
chamado novo, igual ao e-mail. Ressuscitar o antigo esconderia o pedido do SLA.

## Responder pelo Intra

A nota pública do chamado volta para o cliente pelo WhatsApp, na mesma
conversa — igual ao botão de e-mail da triagem (064). Na tela do chamado
aparece **"Enviar por WhatsApp para +55 (11) 99999-0000"** logo abaixo da caixa
de texto, com o que resta da janela ao lado.

Dois secrets a mais:

```bash
supabase secrets set WHATSAPP_TOKEN=<token de acesso do app na Meta>
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<Phone number ID, em API Setup>
supabase functions deploy whatsapp-responder
```

> `WHATSAPP_PHONE_NUMBER_ID` **não é o telefone**: é um id numérico longo que a
> Meta mostra em WhatsApp → API Setup, ao lado do número. Pôr o telefone ali
> dá `Unsupported post request` — erro que não diz qual campo está errado.

> No teste, o token da Meta **vale 24 h**. Quando o envio começar a responder
> `Invalid OAuth access token` do nada, é isso: gere outro, ou crie um token de
> System User, que não expira.

### A janela de 24 h

A Meta só aceita texto livre nas **24 h seguintes à última mensagem do
cliente**. Fora dela, só template aprovado — que é outro caminho inteiro
(aprovação na Meta, variáveis, idioma) e não está aqui.

A conta sai da última fala de quem pediu: a nota `visibility: "solicitante"`
mais nova, ou, num chamado recém-aberto, a própria abertura — porque a primeira
mensagem não virou nota, virou o chamado. **Resposta nossa não reabre a
janela**: se reabrisse, cada mensagem nossa esticaria um prazo que a Meta não
estica, e a tela mentiria.

Fechada a janela, a caixa aparece desabilitada dizendo isso, e a function
recusa com `window_closed` mesmo que alguém chame direto. A nota continua
salva no chamado de qualquer jeito: envio que não sai não apaga o trabalho do
técnico, só avisa.

### Chamado cancelado

Cancelar o chamado não impede responder — a janela é da conversa, não do
chamado. Mas a **próxima** mensagem do cliente abre chamado novo, porque
`cancelado` conta como fechado na casagem da conversa. Então, em duplicata,
cancele um e deixe o outro aberto: a conversa fica num lugar só.

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

**O caminho de volta é o contrário, e por isso é outra function.** A
`whatsapp-responder` é chamada pelo app, com o JWT do operador
(`verify_jwt = true`, mais a conferência de `operators`). Juntar as duas numa
só obrigaria a desligar o `verify_jwt` do caminho que o app usa — e aí o envio
ficaria aberto a quem tem a chave pública, que vai no site.

**O app nunca escolhe o destinatário.** Ele manda `pendencia_id`; o telefone
sai do `email_thread_id` daquele chamado, relido com a chave de serviço. Sem
essa trava, quem tivesse a chave pública mandaria WhatsApp em nome da Init para
qualquer número — é a mesma regra da `pendencia-responder`.

## Casar o telefone

O `wa_id` chega como `5511999990000`; a ficha do cliente tem texto livre. A
comparação usa **DDD + os 8 últimos dígitos**, o que ignora o nono dígito dos
celulares — é o que faz cadastro antigo casar com número atual.

O preço: dois números do mesmo DDD que só diferem no nono dígito viram a mesma
chave. É raro, e quando não casa nada é inventado — vira `sem_cliente` e alguém
olha.
