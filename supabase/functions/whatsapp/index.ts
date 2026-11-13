// Edge Function: whatsapp — webhook de entrada do WhatsApp (hoje, WAHA).
//
// O que faz com cada mensagem de texto que um cliente manda para o número da
// empresa:
//   * se o mesmo número tem chamado ABERTO (pendencias.email_thread_id =
//     "whatsapp:<dígitos>"), vira nota do solicitante nesse chamado e ganha uma
//     linha na caixa como 'anexado' — é a mesma conversa, e um chamado por
//     mensagem deixaria quem atende com vários pela metade;
//   * senão, entra na caixa de entrada (emails_triagem, canal 'whatsapp') para
//     alguém decidir. O webhook NÃO abre chamado sozinho: no WhatsApp chega
//     "bom dia", "obrigado" e foto de boleto, e abrir chamado para isso lotaria
//     a fila. Com cliente casado pelo telefone a linha já vem com a equipe e o
//     cliente; sem, vai como sem_cliente na equipe padrão.
//
// AUTENTICAÇÃO — auth "none" + token na query, e verify_jwt = false no
// config.toml. O WAHA não manda JWT do Supabase; o webhook usa o token na URL
// cadastrada no painel (…/whatsapp?token=…). O token é comparado em tempo
// constante com WHATSAPP_WEBHOOK_TOKEN; sem o segredo configurado, tudo é 401
// (fail-closed). A URL com token nunca vai para log.
//
// IDEMPOTÊNCIA — a WAHA pode reentregar o mesmo evento. A chave
// "whatsapp:<messageId>" em avisos_enviados (051) garante uma passagem por
// mensagem; o email_id UNIQUE da caixa (066) segura o resto.
//
// CONFIGURAÇÃO (supabase secrets set):
//   WHATSAPP_WEBHOOK_TOKEN — o token que vai na URL do webhook no painel.
//   (o envio usa WAHA_BASE_URL, WAHA_API_KEY e WAHA_SESSION, mas só no
//   whatsapp-responder.)

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type EmailEntrada, entradaDaCaixa, notaDoSolicitante } from "../robo/campo.ts";
import {
  assuntoDaMensagem,
  chaveTelefone,
  clienteDoTelefone,
  conversaDoTelefone,
  funcaoAusente,
  LIMITE_POR_MINUTO,
  LOTE_MAX,
  type MensagemWhats,
  PEN_FECHADOS,
  tempoConstante,
} from "./mensagem.ts";
import { mensagensDoWebhook } from "./provedor.ts";

type ClienteFone = {
  id: string;
  name: string;
  team?: string | null;
  technician?: string | null;
  owner_phone?: string | null;
  responsible_phone?: string | null;
};

type Aberto = {
  id: string;
  status: string;
  notes: unknown;
  client_id: string | null;
  team: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Caminho antigo, só para banco sem a 077: lê clients inteiro.
async function todosOsClientes(db: SupabaseClient): Promise<ClienteFone[]> {
  const out: ClienteFone[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("clients")
      .select("id, name, team, technician, owner_phone, responsible_phone")
      .range(from, from + 999);
    if (error) throw new Error("clients: " + error.message);
    out.push(...((data || []) as ClienteFone[]));
    if (!data || data.length < 1000) return out;
  }
}

// Candidatos pelo índice da 077; a regra de ambiguidade continua em
// clienteDoTelefone, que é a mesma testada no vitest.
async function clienteDaMensagem(
  db: SupabaseClient,
  telefone: string,
  cache: { todos: ClienteFone[] | null }
): Promise<ClienteFone | null> {
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  const { data, error } = await db.rpc("clientes_do_telefone", { p_chave: chave });
  if (!error) return clienteDoTelefone((data || []) as ClienteFone[], telefone);
  // Erro de verdade não derruba a mensagem: a chave de dedupe já foi gravada,
  // então um 500 aqui faria a reentrega ser ignorada e a mensagem sumir. Sem
  // cliente, ela ao menos chega na caixa para alguém escolher.
  if (!funcaoAusente(error)) {
    console.error("whatsapp clientes_do_telefone:", error.message);
    return null;
  }
  if (!cache.todos) {
    console.warn("whatsapp: migration 077 não aplicada, casando cliente pela tabela inteira");
    cache.todos = await todosOsClientes(db);
  }
  return clienteDoTelefone(cache.todos, telefone);
}

// Soma a nota no chamado. Com a 077 é um UPDATE só no banco (sem corrida entre
// duas mensagens do mesmo número); sem ela, o ler-e-regravar antigo. Nos dois,
// filtra por id E pelo team lido: se o chamado mudou de equipe no meio, não
// grava em vez de gravar no escopo errado — e aí a mensagem segue para a caixa
// como pedido novo, em vez de sumir.
type Anexo = { ok: true } | { ok: false; naoAchou: boolean; erro: string };
async function anexarNota(db: SupabaseClient, aberto: Aberto, nota: unknown): Promise<Anexo> {
  const { data, error } = await db.rpc("append_pendencia_note", { p_id: aberto.id, p_team: aberto.team, p_nota: nota });
  if (!error)
    return data === true ? { ok: true } : { ok: false, naoAchou: true, erro: "chamado mudou de equipe ou sumiu" };
  if (!funcaoAusente(error)) return { ok: false, naoAchou: false, erro: error.message };
  console.warn("whatsapp: migration 077 não aplicada, anexando nota por ler-e-regravar");
  const anteriores = Array.isArray(aberto.notes) ? aberto.notes : [];
  let q = db
    .from("pendencias")
    .update({ notes: [...anteriores, nota], updated_at: new Date().toISOString() })
    .eq("id", aberto.id);
  q = aberto.team == null ? q.is("team", null) : q.eq("team", aberto.team);
  const { error: erroUpdate } = await q;
  return erroUpdate ? { ok: false, naoAchou: false, erro: erroUpdate.message } : { ok: true };
}

// Quantas mensagens deste número entraram na caixa no último minuto. Usa o
// índice (telefone, recebido_em) da 075. Erro de leitura não segura a
// mensagem: o limite protege a fila, não é controle de acesso.
async function recentesDoNumero(db: SupabaseClient, telefone: string): Promise<number> {
  const desde = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await db
    .from("emails_triagem")
    .select("id", { count: "exact", head: true })
    .eq("telefone", telefone)
    .gte("recebido_em", desde);
  if (error) {
    console.error("whatsapp limite:", error.message);
    return 0;
  }
  return count || 0;
}

// Fechado não conta: mensagem depois de concluir é pedido novo, e ressuscitar
// o chamado antigo esconderia isso do SLA e da fila.
//
// Sem filtro de team de propósito: a equipe só se sabe depois de casar o
// cliente, e o mesmo número pode ter chamado aberto em qualquer equipe. O
// update da nota filtra por id + team lidos aqui.
async function chamadoDaConversa(db: SupabaseClient, conversa: string): Promise<Aberto | null> {
  if (!conversa) return null;
  const { data, error } = await db
    .from("pendencias")
    .select("id, status, notes, client_id, team")
    .eq("email_thread_id", conversa)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("whatsapp conversa:", error.message);
    return null;
  }
  return ((data || []) as Aberto[]).find((p) => !PEN_FECHADOS.includes(String(p.status))) || null;
}

// A mensagem no formato que os helpers da caixa (robo/campo.ts) já entendem.
function entradaDe(m: MensagemWhats): EmailEntrada {
  return {
    id: "whatsapp:" + m.id,
    de: m.nome || "+" + m.telefone,
    assunto: assuntoDaMensagem(m.texto),
    data: m.quando,
    trecho: m.texto,
    message_id: m.id,
    thread_id: conversaDoTelefone(m.telefone),
  };
}

// Banco sem a 075 falha aqui (coluna canal/telefone não existe): o erro fica no
// log e a nota, se houve, já está salva. A chave de dedupe NÃO volta, pelo
// mesmo motivo do robô: reentrega repetiria o erro para sempre.
async function baixarMidia(m: MensagemWhats) {
  if (!m.media) return null;
  try {
    const base = Deno.env.get("WAHA_BASE_URL") || "";
    const key = Deno.env.get("WAHA_API_KEY") || "";
    const origem = new URL(m.media.url);
    const url = new URL(origem.pathname + origem.search, base).toString();
    const resp = await fetch(url, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(20000) });
    const tamanho = Number(resp.headers.get("content-length") || 0);
    if (!resp.ok || tamanho > 5 * 1024 * 1024) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return null;
    let binario = "";
    for (let i = 0; i < bytes.length; i += 32768) binario += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { nome: m.media.nome, tipo: m.media.tipo, dados: btoa(binario) };
  } catch (err) {
    console.error(`whatsapp mídia ${m.id}:`, (err as Error).message);
    return null;
  }
}

// Banco sem a 082 não tem direcao/media. O PostgREST recusa o insert inteiro
// (PGRST204, coluna fora do schema cache) e o Postgres direto devolve 42703:
// sem o retry, a mensagem sumiria da caixa por causa de uma coluna que é só do
// portal. O histórico do portal fica para quando a migration rodar.
function colunaDoPortalAusente(error: { code?: string; message?: string }): boolean {
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = error.message || "";
  return /(direcao|media)/.test(msg) && /does not exist|schema cache/i.test(msg);
}

async function guardarNaCaixa(
  db: SupabaseClient,
  m: MensagemWhats,
  opcoes: {
    motivo?: string | null;
    status?: string;
    pendenciaId?: string | null;
    clientId?: string | null;
    team?: string | null;
  }
): Promise<boolean> {
  const linha = {
    ...entradaDaCaixa(entradaDe(m), opcoes, "ETR-" + crypto.randomUUID()),
    canal: "whatsapp",
    telefone: m.telefone,
    direcao: "entrada",
    media: await baixarMidia(m),
  };
  const { error } = await db.from("emails_triagem").insert(linha);
  if (!error || error.code === "23505") return true;
  if (colunaDoPortalAusente(error)) {
    console.warn(`whatsapp caixa ${m.id}: migration 082 não aplicada, gravando sem direcao/media`);
    const { direcao: _direcao, media: _media, ...semPortal } = linha;
    const { error: erroAntigo } = await db.from("emails_triagem").insert(semPortal);
    if (!erroAntigo || erroAntigo.code === "23505") return true;
    console.error(`whatsapp caixa ${m.id} (a mensagem NÃO apareceu na caixa):`, erroAntigo.message);
    return false;
  }
  console.error(`whatsapp caixa ${m.id} (a mensagem NÃO apareceu na caixa):`, error.message);
  return false;
}

async function handle(req: Request, ctx: SupabaseContext) {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const esperado = Deno.env.get("WHATSAPP_WEBHOOK_TOKEN") || "";
  const recebido = new URL(req.url).searchParams.get("token") || "";
  if (!esperado || !recebido || !tempoConstante(recebido, esperado)) return json({ ok: false }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  // Evento que não é mensagem de texto (status, entrega, presença) responde 200
  // vazio: erro faria a WAHA reentregar algo que nunca vai ser tratado.
  const todas = mensagensDoWebhook(payload);
  if (!todas.length) return json({ ok: true, notas: 0, caixa: 0, sem_cliente: 0, limitadas: 0 });
  if (todas.length > LOTE_MAX) console.warn(`whatsapp: lote de ${todas.length} mensagens, tratando só ${LOTE_MAX}`);
  const msgs = todas.slice(0, LOTE_MAX);

  const db = ctx.supabaseAdmin;
  try {
    let notas = 0,
      caixa = 0,
      semCliente = 0,
      limitadas = 0;
    const cache: { todos: ClienteFone[] | null } = { todos: null };
    for (const m of msgs) {
      const key = "whatsapp:" + m.id;
      const { error: erroChave } = await db.from("avisos_enviados").insert({ key });
      if (erroChave) {
        if (erroChave.code === "23505") continue;
        throw new Error("avisos_enviados: " + erroChave.message);
      }

      // Depois da chave de dedupe: reentrega da mesma mensagem não conta duas
      // vezes, e a descartada aqui não volta numa reentrega.
      if (await recentesDoNumero(db, m.telefone) >= LIMITE_POR_MINUTO) {
        limitadas++;
        console.warn(`whatsapp: ${m.id} descartada, número passou de ${LIMITE_POR_MINUTO} mensagens por minuto`);
        continue;
      }

      // Prova, gravada só pelo servidor, de que este número falou com a empresa:
      // o whatsapp-responder recusa enviar para quem não está aqui (076). Falha
      // não segura a mensagem — o pior caso é a resposta ser recusada depois.
      const { error: erroConversa } = await db
        .from("whatsapp_conversas")
        .upsert({ telefone: m.telefone, ultima_em: new Date().toISOString() }, { onConflict: "telefone" });
      if (erroConversa) console.error(`whatsapp conversa ${m.id}:`, erroConversa.message);

      const aberto = await chamadoDaConversa(db, conversaDoTelefone(m.telefone));
      if (aberto) {
        const anexo = await anexarNota(db, aberto, notaDoSolicitante(entradaDe(m)));
        if (anexo.ok) {
          notas++;
          if (
            await guardarNaCaixa(db, m, {
              status: "anexado",
              pendenciaId: aberto.id,
              clientId: aberto.client_id,
              team: aberto.team || "init",
            })
          )
            caixa++;
          continue;
        }
        console.error(`whatsapp nota ${m.id}:`, anexo.erro);
        if (!anexo.naoAchou) {
          await db.from("avisos_enviados").delete().eq("key", key); // tenta de novo na reentrega
          continue;
        }
      }

      const c = await clienteDaMensagem(db, m.telefone, cache);
      if (!c) semCliente++;
      const ok = await guardarNaCaixa(
        db,
        m,
        c
          ? { motivo: null, status: "pendente", clientId: c.id, team: c.team || "init" }
          : { motivo: "sem_cliente", status: "pendente", team: "init" }
      );
      if (ok) caixa++;
    }
    return json({ ok: true, notas, caixa, sem_cliente: semCliente, limitadas });
  } catch (err) {
    // 500 faz a WAHA reentregar; a chave de dedupe impede processar duas vezes
    // o que já passou.
    console.error("whatsapp:", (err as Error).message);
    return json({ ok: false }, 500);
  }
}

export default { fetch: withSupabase({ auth: "none" }, handle) };
