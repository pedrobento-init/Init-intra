# Integração com o TeamViewer

Anotações da conversa de 18/11/2026. **Nada disso está implementado**; é o ponto
de partida para decidir. Os preços e limites vêm de fontes de terceiros e de
busca na web, não da página oficial: confirmar antes de decidir qualquer compra.

## Situação de hoje

- A ficha do cliente guarda o tipo de acesso remoto (AnyDesk, TeamViewer, RDP,
  SSH, VPN) e o ID num cofre protegido (migration 043, `js/client-secrets.js`).
- O botão **Abrir** só existe para AnyDesk (`anydesk:ID`, em
  `js/clients-ficha.js`). TeamViewer aparece na lista de tipos, sem botão.
- O TeamViewer é a base do suporte remoto da equipe.

## O que se sabe do plano

- Não se sabe o plano. O único dado é um aviso do programa ("Sua licença agora
  inclui acesso a recursos avançados de IA e produtividade"), que não identifica
  o plano.
- São 3 (talvez 4) licenças, e **cada técnico tem a própria conta**.
- Referência de limites (fonte de terceiros): Business = 1 usuário, Premium = 15,
  Corporate = 30. Três licenças Business soltas e uma conta de empresa com
  vários usuários pedem integrações diferentes (ver abaixo).

## Perguntas para quem administra a conta

1. Qual é o nome do plano (Business, Premium, Corporate, Tensor)?
2. Os técnicos são usuários de uma mesma empresa, num gerenciamento de usuários
   único, ou são contas/licenças separadas?
3. O console mostra relatórios de conexões (técnico, dispositivo, data,
   duração)? Um print dessa tela mostra o que a API entrega.
4. Quem administra consegue criar um app e um token no console do TeamViewer?

A resposta 2 decide o desenho: conta de empresa = um token cobre todos; contas
separadas = um token por técnico.

## Ideias, da mais útil para a menos

| #   | Integração                                             | Esforço |
| --- | ------------------------------------------------------ | ------- |
| 1   | Apontamento automático de horas (histórico de sessões) | grande  |
| 2   | Sessões na linha do tempo do chamado e no relatório    | médio   |
| 3   | Dispositivo online/offline na ficha e no chamado       | médio   |
| 4   | Importar dispositivos como equipamentos (ID por PC)    | médio   |
| 5   | Botão "Abrir no TeamViewer" (`teamviewer10://`)        | pequeno |

- A 1 precisa de Edge Function com o segredo, migration e uma tela de
  conferência: o histórico não diz a qual chamado cada sessão pertence.
- A comunidade relata que o relatório de conexões às vezes vem sem a informação
  de grupo; se o vínculo com o cliente depender do grupo, testar na conta real.
- A 5 não depende das respostas acima, mas não foi testada com o programa
  instalado e não funciona no celular.

## Custo (referência, cobrança anual, valores divergem entre fontes)

- A API não exige licença para desenvolver; quem conecta precisa de licença
  TeamViewer (a equipe já tem).
- Business ~US$ 50,90/mês; Premium US$ 112,90 a 120,90; Corporate US$ 229,90 a
  245,90; Tensor sob cotação.
- Um limite de 300 chamadas/hora aparece numa fonte de terceiros; não confirmado
  na documentação oficial.
- Infraestrutura: roda nas Edge Functions do Supabase já usadas.

## Fontes

- <https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/for-developers/build-a-teamviewer-integration/>
- <https://www.teamviewer.com/nl/global/support/knowledge-base/teamviewer-classic/integrations/core-integrations/teamviewer-api/>
- <https://www.teamviewer.com/tr/global/support/knowledge-base/teamviewer-classic/licensing/purchase/licenses-overview>
- <https://www.costbench.com/software/remote-desktop/teamviewer/>
