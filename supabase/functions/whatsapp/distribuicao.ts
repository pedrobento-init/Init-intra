// Filas do WhatsApp no banco: o que o webhook faz com a mensagem depois que ela
// já está na caixa. A regra (quem recebe, quando distribuir) mora em filas.ts;
// aqui só se lê e grava.
//
// Ordem, para cada mensagem do cliente sem chamado aberto:
//   1. grava o departamento escolhido no menu nas mensagens pendentes da
//      conversa (é por ele que a Caixa separa as filas);
//   2. conversa com responsável aberto: a mensagem nova herda o nome e acabou;
//   3. cliente ainda no menu: espera a escolha;
//   4. equipe com rodízio ligado (whatsapp_filas_config): escolhe o atendente
//      e atribui pela função whatsapp_atribuir_se_livre, que trava a conversa
//      e não atribui se alguém pegou no meio (o "Pegar próximo" da Caixa usa a
//      mesma trava).
//
// NUNCA derruba a mensagem: ela já está na caixa quando isto roda. Erro vai
// para o log e a conversa fica na fila, onde alguém pega à mão. Banco sem a
// migration 087 para no primeiro passo, com um aviso.
//
// Sem import `npm:` de propósito: o vitest importa este arquivo pelo webhook
// empacotado e o dublê do Supabase entra no lugar de `db`.

import { type Decisao, type EstadoBot } from './bot.ts';
import { funcaoAusente } from './mensagem.ts';
import {
  type Atendente,
  type ConfigFila,
  type LinhaAberta,
  contarAbertos,
  conversaNoMenu,
  departamentoDaConversa,
  escolherAtendente,
  responsavelAberto,
  STATUS_ABERTOS,
} from './filas.ts';

// O dublê dos testes e o cliente de verdade têm a mesma forma encadeável; um
// tipo estreito aqui obrigaria a importar o supabase-js (`npm:`).
// deno-lint-ignore no-explicit-any
type Db = any;

export type ResultadoFila = 'sem_087' | 'mantido' | 'menu' | 'fila' | 'distribuida' | 'erro';

// Coluna ou tabela da 087 que não existe: PostgREST (PGRST204 coluna fora do
// cache, PGRST205 tabela) ou Postgres direto (42703, 42P01).
export function filasAusentes(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(String(error.code || ''))) return true;
  const msg = error.message || '';
  return (
    /(departamento|whatsapp_filas_config|whatsapp_atendentes)/.test(msg) &&
    /does not exist|schema cache|could not find/i.test(msg)
  );
}

async function atribuirSeLivre(
  db: Db,
  team: string,
  telefone: string,
  operador: string,
  agora: Date
): Promise<boolean> {
  const { data, error } = await db.rpc('whatsapp_atribuir_se_livre', {
    p_team: team,
    p_telefone: telefone,
    p_operador: operador,
  });
  if (!error) return data === true;
  if (!funcaoAusente(error)) {
    console.error('whatsapp fila atribuir:', error.message);
    return false;
  }
  // Função ausente com tabela presente (087 aplicada pela metade): update
  // condicional. Sem a trava, uma corrida com o "Pegar próximo" pode dar dois
  // nomes na mesma conversa; o último a gravar vence, como era antes.
  const { error: erroUpdate } = await db
    .from('emails_triagem')
    .update({
      atribuido_a: operador,
      atribuido_em: agora.toISOString(),
      updated_at: agora.toISOString(),
    })
    .eq('canal', 'whatsapp')
    .eq('telefone', telefone)
    .eq('team', team)
    .in('status', STATUS_ABERTOS)
    .is('atribuido_a', null);
  if (erroUpdate) console.error('whatsapp fila atribuir (sem função):', erroUpdate.message);
  return !erroUpdate;
}

export async function aplicarFilas(
  db: Db,
  p: {
    telefone: string;
    team: string;
    estado: EstadoBot;
    decisao: Decisao | null;
    agora: Date;
  }
): Promise<ResultadoFila> {
  const { telefone, team, agora } = p;
  const quando = agora.toISOString();
  try {
    const departamento = departamentoDaConversa(p.estado, p.decisao);
    if (departamento) {
      const { error } = await db
        .from('emails_triagem')
        .update({ departamento, updated_at: quando })
        .eq('canal', 'whatsapp')
        .eq('telefone', telefone)
        .eq('team', team)
        .eq('direcao', 'entrada')
        .eq('status', 'pendente')
        .is('departamento', null);
      if (error) {
        if (filasAusentes(error)) {
          console.warn('whatsapp: migration 087 não aplicada, conversa sem fila nem rodízio');
          return 'sem_087';
        }
        console.error('whatsapp fila departamento:', error.message);
      }
    }

    const { data: linhas, error: erroLinhas } = await db
      .from('emails_triagem')
      .select('telefone, atribuido_a, direcao, status')
      .eq('canal', 'whatsapp')
      .eq('telefone', telefone)
      .eq('team', team)
      .in('status', STATUS_ABERTOS)
      .limit(500);
    if (erroLinhas) {
      console.error('whatsapp fila conversa:', erroLinhas.message);
      return 'erro';
    }
    const responsavel = responsavelAberto((linhas || []) as LinhaAberta[]);
    if (responsavel) {
      // A mensagem nova chega sem nome; sem herdar, ela contaria como fila
      // para o "Pegar próximo" de outro operador.
      const { error } = await db
        .from('emails_triagem')
        .update({ atribuido_a: responsavel, atribuido_em: quando, updated_at: quando })
        .eq('canal', 'whatsapp')
        .eq('telefone', telefone)
        .eq('team', team)
        .eq('status', 'pendente')
        .is('atribuido_a', null);
      if (error) console.error('whatsapp fila responsável:', error.message);
      return 'mantido';
    }

    if (conversaNoMenu(p.decisao)) return 'menu';

    const { data: config, error: erroConfig } = await db
      .from('whatsapp_filas_config')
      .select('rodizio_ativo, limite_simultaneo')
      .eq('team', team)
      .maybeSingle();
    if (erroConfig) {
      if (filasAusentes(erroConfig)) {
        console.warn('whatsapp: migration 087 não aplicada, sem rodízio');
        return 'sem_087';
      }
      console.error('whatsapp fila config:', erroConfig.message);
      return 'erro';
    }
    if (!config || !(config as ConfigFila).rodizio_ativo) return 'fila';

    const { data: atendentes, error: erroAt } = await db
      .from('whatsapp_atendentes')
      .select(
        'operador, departamentos, limite, recebe_rodizio, disponivel, visto_em, ultima_atribuicao_em'
      )
      .eq('team', team);
    if (erroAt) {
      console.error('whatsapp fila atendentes:', erroAt.message);
      return 'erro';
    }
    const lista = ((atendentes || []) as Atendente[]).filter((a) => a.recebe_rodizio !== false);
    if (!lista.length) return 'fila';

    // Sem filtro por nome no PostgREST: o nome vem de operators.name, que o
    // próprio operador edita, e aspas ali quebravam a query (e o rodízio da
    // equipe inteira). Filtra por nome aqui, depois de ler.
    const nomes = new Set(lista.map((a) => a.operador));
    const { data: abertasTodas, error: erroAbertas } = await db
      .from('emails_triagem')
      .select('telefone, atribuido_a, direcao, status')
      .eq('canal', 'whatsapp')
      .eq('team', team)
      .in('status', STATUS_ABERTOS)
      .not('atribuido_a', 'is', null)
      .limit(5000);
    const abertas = ((abertasTodas || []) as LinhaAberta[]).filter((r) =>
      nomes.has(String(r.atribuido_a || ''))
    );
    // Sem a contagem o limite não teria como ser respeitado: melhor deixar na
    // fila que entregar a quem já está cheio.
    if (erroAbertas) {
      console.error('whatsapp fila abertos:', erroAbertas.message);
      return 'erro';
    }

    const escolhido = escolherAtendente(lista, {
      departamento,
      config: config as ConfigFila,
      abertos: contarAbertos((abertas || []) as LinhaAberta[]),
      agora,
    });
    if (!escolhido) return 'fila';
    if (!(await atribuirSeLivre(db, team, telefone, escolhido, agora))) return 'fila';

    // É o desempate do próximo rodízio; falhar aqui só pesa na justiça da vez.
    const { error: erroVez } = await db
      .from('whatsapp_atendentes')
      .update({ ultima_atribuicao_em: quando })
      .eq('team', team)
      .eq('operador', escolhido);
    if (erroVez) console.error('whatsapp fila vez:', erroVez.message);
    return 'distribuida';
  } catch (err) {
    console.error('whatsapp fila:', (err as Error).message);
    return 'erro';
  }
}
