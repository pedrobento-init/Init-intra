// Em que equipes um número de WhatsApp já escreveu (whatsapp_conversa_equipes,
// migration 088). Só o webhook grava, com service role; o app não lê nem
// escreve a tabela.
//
// POR QUE EXISTE: "a equipe enxerga a conversa" lido de emails_triagem não
// prova nada, porque a RLS deixa o operador inserir e alterar linhas da própria
// equipe com qualquer telefone. Bastava uma linha forjada para a equipe A
// mandar mensagem (envio ativo, encerramento, pesquisa, lembrete) a um
// contato que só falou com a equipe B. A prova de verdade é o webhook ter
// gravado uma mensagem DAQUELE número NAQUELA equipe.
//
// Sem imports `npm:` de propósito: o vitest importa este arquivo direto.

// deno-lint-ignore no-explicit-any
type Db = any;

const TABELA = 'whatsapp_conversa_equipes';

function digitos(telefone: string): string {
  return String(telefone || '').replace(/\D/g, '');
}

/**
 * true: o número escreveu para a equipe. false: não escreveu. null: não deu
 * para saber (088 não aplicada ou erro de leitura) — quem chama trata como
 * "não", porque o caso é mandar mensagem a alguém.
 */
export async function numeroEscreveuParaEquipe(
  db: Db,
  telefone: string,
  team: string
): Promise<boolean | null> {
  const fone = digitos(telefone);
  const equipe = String(team || '').trim() || 'init';
  if (!fone) return false;
  const { data, error } = await db
    .from(TABELA)
    .select('telefone')
    .eq('telefone', fone)
    .eq('team', equipe)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('whatsapp equipes do número (migration 088?):', error.message);
    return null;
  }
  return !!data;
}

/** Registra que o número escreveu para a equipe. Nunca lança. */
export async function registrarEquipeDoNumero(
  db: Db,
  telefone: string,
  team: string | null | undefined
): Promise<void> {
  const fone = digitos(telefone);
  const equipe = String(team || '').trim() || 'init';
  if (!fone) return;
  try {
    const { error } = await db
      .from(TABELA)
      .upsert(
        { telefone: fone, team: equipe },
        { onConflict: 'telefone,team', ignoreDuplicates: true }
      );
    if (error) console.warn('whatsapp equipes do número (migration 088?):', error.message);
  } catch (err) {
    console.warn('whatsapp equipes do número:', (err as Error).message);
  }
}
