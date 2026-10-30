// Edge Function: whatsapp — webhook de entrada do WhatsApp (hoje, Z-API).
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
// config.toml. A Z-API não manda JWT do Supabase, não assina o corpo e não
// deixa configurar cabeçalho no webhook: o único segredo que dá para pôr é na
// URL cadastrada no painel (…/whatsapp?token=…). O token é comparado em tempo
// constante com WHATSAPP_WEBHOOK_TOKEN; sem o segredo configurado, tudo é 401
// (fail-closed). A URL com token nunca vai para log.
//
// IDEMPOTÊNCIA — a Z-API pode reentregar o mesmo evento. A chave
// "whatsapp:<messageId>" em avisos_enviados (051) garante uma passagem por
// mensagem; o email_id UNIQUE da caixa (066) segura o resto.
//
// CONFIGURAÇÃO (supabase secrets set):
//   WHATSAPP_WEBHOOK_TOKEN — o token que vai na URL do webhook no painel.
//   (o envio usa ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_CLIENT_TOKEN, mas só no
//   whatsapp-responder.)

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type EmailEntrada, entradaDaCaixa, notaDoSolicitante } from "../robo/campo.ts";
import {
  assuntoDaMensagem,
  clienteDoTelefone,
  conversaDoTelefone,
  type MensagemWhats,
  tempoConstante,
} from "./mensagem.ts";
import { mensagensDoWebhook } from "./provedor.ts";

const PEN_FECHADOS = ["concluido", "resolvido", "cancelado", "fechado"];

type ClienteFone = {
  id: string;
  name: string;
  team?: string | null;
  technician?: string | null;
  owner_phone?: string | null;
  responsible_phone?: string | null;
};

type Aberto = { id: string; status: string; notes: unknown; client_id: string | null; team: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function clientes(db: SupabaseClient): Promise<ClienteFone[]> {
  const out: ClienteFone[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("clients")
      .select("id, name, team, technician, owner_phone, responsible_phone")
      .range(from, from + 999);
    if (error) throw new Error("clients: " + error.message);
    out.push(...((data || []) as ClienteFone[]));
    if (!data || data.length < 1000) return out;
  }
}

// Fechado não conta: mensagem depois de concluir é pedido novo, e ressuscitar
// o chamado antigo esconderia isso do SLA e da fila.
async function chamadoDaConversa(db: SupabaseClient, conversa: string): Promise<Aberto | null> {
  if (!conversa) return null;
  const { data, error } = await db.from("pendencias")
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
async function guardarNaCaixa(
  db: SupabaseClient,
  m: MensagemWhats,
  opcoes: { motivo?: string | null; status?: string; pendenciaId?: string | null; clientId?: string | null; team?: string | null },
): Promise<boolean> {
  const linha = {
    ...entradaDaCaixa(entradaDe(m), opcoes, "ETR-" + crypto.randomUUID()),
    canal: "whatsapp",
    telefone: m.telefone,
  };
  const { error } = await db.from("emails_triagem").insert(linha);
  if (!error || error.code === "23505") return true;
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
  // vazio: erro faria a Z-API reentregar algo que nunca vai ser tratado.
  const msgs = mensagensDoWebhook(payload);
  if (!msgs.length) return json({ ok: true, notas: 0, caixa: 0, sem_cliente: 0 });

  const db = ctx.supabaseAdmin;
  try {
    let notas = 0, caixa = 0, semCliente = 0;
    let lista: ClienteFone[] | null = null;
    for (const m of msgs) {
      const key = "whatsapp:" + m.id;
      const { error: erroChave } = await db.from("avisos_enviados").insert({ key });
      if (erroChave) {
        if (erroChave.code === "23505") continue;
        throw new Error("avisos_enviados: " + erroChave.message);
      }

      const aberto = await chamadoDaConversa(db, conversaDoTelefone(m.telefone));
      if (aberto) {
        const anteriores = Array.isArray(aberto.notes) ? aberto.notes : [];
        // Filtra pelo team que acabou de ler: se o chamado mudou de equipe no
        // meio, o update não acha a linha em vez de gravar no escopo errado.
        let q = db.from("pendencias")
          .update({ notes: [...anteriores, notaDoSolicitante(entradaDe(m))], updated_at: new Date().toISOString() })
          .eq("id", aberto.id);
        q = aberto.team == null ? q.is("team", null) : q.eq("team", aberto.team);
        const { error: erroNota } = await q;
        if (erroNota) {
          await db.from("avisos_enviados").delete().eq("key", key);  // tenta de novo na reentrega
          console.error(`whatsapp nota ${m.id}:`, erroNota.message);
          continue;
        }
        notas++;
        if (await guardarNaCaixa(db, m, { status: "anexado", pendenciaId: aberto.id, clientId: aberto.client_id, team: aberto.team || "init" })) caixa++;
        continue;
      }

      lista ??= await clientes(db);
      const c = clienteDoTelefone(lista, m.telefone);
      if (!c) semCliente++;
      const ok = await guardarNaCaixa(db, m, c
        ? { motivo: null, status: "pendente", clientId: c.id, team: c.team || "init" }
        : { motivo: "sem_cliente", status: "pendente", team: "init" });
      if (ok) caixa++;
    }
    return json({ ok: true, notas, caixa, sem_cliente: semCliente });
  } catch (err) {
    // 500 faz a Z-API reentregar; a chave de dedupe impede processar duas vezes
    // o que já passou.
    console.error("whatsapp:", (err as Error).message);
    return json({ ok: false }, 500);
  }
}

export default { fetch: withSupabase({ auth: "none" }, handle) };
