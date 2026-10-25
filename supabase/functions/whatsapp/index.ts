// supabase/functions/whatsapp/index.ts
// Edge Function: portal de atendimento por WhatsApp. O cliente manda mensagem
// para o número da Init e vira chamado, com a mesma triagem do e-mail.
//
// CONFIGURAÇÃO (secrets):
//   WHATSAPP_VERIFY_TOKEN .. string que VOCÊ inventa e repete no painel da
//                            Meta ao cadastrar o webhook. Só serve para o
//                            handshake de verificação.
//   WHATSAPP_APP_SECRET ... "App secret" do app na Meta. É com ele que a
//                            assinatura de cada POST é conferida — é ESTE que
//                            protege a função, não o verify token.
//   IA_WEBHOOK_URL ........ o mesmo do robô. Sem ele a triagem segue sem IA.
//   supabase functions deploy whatsapp
//
// POR QUE auth: "none": quem chama é a Meta, que não tem como mandar chave do
// Supabase. A autenticação é a assinatura HMAC do corpo (X-Hub-Signature-256),
// conferida em assinaturaValida() antes de qualquer leitura do payload — o
// mesmo desenho de um webhook de pagamento. `verify_jwt = false` no
// config.toml, senão a plataforma barra a Meta antes de chegar aqui.
//
// O QUE ESTE PRIMEIRO TESTE NÃO FAZ: não responde pelo WhatsApp. A janela de
// 24 h da Meta exige template aprovado fora dela, e isso é um caminho de volta
// inteiro — fica para depois do teste.

import { withSupabase } from "npm:@supabase/server@1";
import { type Cliente, notaDoSolicitante } from "../robo/campo.ts";
import {
  assinaturaValida,
  clienteDoTelefone,
  entradaDaMensagem,
  type MensagemWhats,
  mensagensDoWebhook,
  pendenciaDoWhatsapp,
  triagemDaMensagem,
} from "./mensagem.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const IA_WEBHOOK_URL = Deno.env.get("IA_WEBHOOK_URL") ?? "";

const PEN_FECHADOS = ["concluido", "resolvido", "cancelado", "fechado"];
const MSG_MAX = 100; // teto por entrega, como a triagem de e-mail

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Classificação pelo Make, igual à do e-mail. Falhou, devolve "" (vale a mensagem). */
async function classificarComIa(m: MensagemWhats, c: Cliente): Promise<string> {
  if (!IA_WEBHOOK_URL) return "";
  const e = entradaDaMensagem(m);
  try {
    const res = await fetch(IA_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tarefa: "triagem",
        email_id: e.id,
        de: e.de,
        assunto: e.assunto,
        data: e.data,
        trecho: e.trecho.slice(0, 2000),
        cliente: c.name || "",
      }),
      signal: AbortSignal.timeout(25000),
    });
    return res.ok ? await res.text() : "";
  } catch (err) {
    console.error(`whatsapp triagem IA ${m.id}:`, (err as Error).message);
    return "";
  }
}

/**
 * Chamado ABERTO desta conversa, ou null. Mesma regra da 065: fechado não
 * conta, porque mensagem depois de concluir é pedido novo.
 *
 * No WhatsApp isto não é refinamento, é o mínimo: as pessoas mandam cinco
 * mensagens seguidas, e sem casar a conversa cada "oi" viraria um chamado.
 */
// deno-lint-ignore no-explicit-any
async function chamadoDaConversa(db: any, waId: string) {
  const { data, error } = await db.from("pendencias")
    .select("id, status, notes")
    .eq("email_thread_id", "whatsapp:" + waId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("whatsapp conversa:", error.message); // banco sem a 065
    return null;
  }
  return (data || []).find((p: { status: string }) => !PEN_FECHADOS.includes(String(p.status))) || null;
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req: Request, ctx) => {
    const db = ctx.supabaseAdmin;

    // ── Handshake: a Meta chama uma vez, no cadastro do webhook ──
    if (req.method === "GET") {
      const q = new URL(req.url).searchParams;
      const token = q.get("hub.verify_token") ?? "";
      const challenge = q.get("hub.challenge") ?? "";
      if (!VERIFY_TOKEN || q.get("hub.mode") !== "subscribe" || token !== VERIFY_TOKEN) {
        return json({ error: "Não autorizado" }, 401);
      }
      // A Meta exige o challenge cru de volta, não JSON.
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!APP_SECRET) return json({ error: "Indisponível" }, 500);

    // Corpo CRU antes de qualquer parse: é sobre ele que a assinatura fecha.
    const cru = await req.text();
    const ok = await assinaturaValida(cru, req.headers.get("x-hub-signature-256"), APP_SECRET);
    if (!ok) return json({ error: "Não autorizado" }, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(cru);
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const msgs = mensagensDoWebhook(payload).slice(0, MSG_MAX);
    // 200 sempre que a assinatura fecha: recibo de leitura e evento que não é
    // mensagem são normais, e erro aqui faz a Meta reenviar em loop.
    if (!msgs.length) return json({ success: true, mensagens: 0, abertas: 0, notas: 0, sem_cliente: [] });

    const { data: clientes } = await db.from("clients").select("id, name, team, technician, owner_phone, responsible_phone");
    const abertas: string[] = [];
    const semCliente: string[] = [];
    let notas = 0;

    for (const m of msgs) {
      // Uma vez por mensagem, mesmo com a Meta reenviando a mesma entrega.
      const key = `whatsapp:${m.id}`;
      const { error } = await db.from("avisos_enviados").insert({ key });
      if (error) {
        if (error.code === "23505") continue;
        console.error(`whatsapp dedupe ${m.id}:`, error.message);
        continue;
      }

      // Conversa que já tem chamado aberto: a mensagem é a MESMA história.
      const aberto = await chamadoDaConversa(db, m.waId);
      if (aberto) {
        const anteriores = Array.isArray(aberto.notes) ? aberto.notes : [];
        const { error: erroNota } = await db.from("pendencias").update({
          notes: [...anteriores, notaDoSolicitante(entradaDaMensagem(m))],
          updated_at: new Date().toISOString(),
        }).eq("id", aberto.id);
        if (erroNota) {
          await db.from("avisos_enviados").delete().eq("key", key);
          console.error(`whatsapp nota ${m.id}:`, erroNota.message);
          continue;
        }
        notas++;
        continue;
      }

      const c = clienteDoTelefone((clientes || []) as Cliente[], m.waId);
      if (!c) { semCliente.push("+" + m.waId); continue; }

      const t = triagemDaMensagem(await classificarComIa(m, c), m);
      if (t.ignorar) continue;

      const pen = pendenciaDoWhatsapp(t, m, c, "PEN-" + crypto.randomUUID(), new Date());
      const { error: erroPen } = await db.from("pendencias").insert(pen);
      if (erroPen) {
        await db.from("avisos_enviados").delete().eq("key", key);
        console.error(`whatsapp pendência ${m.id}:`, erroPen.message);
        continue;
      }
      abertas.push(pen.id);
    }

    return json({
      success: true,
      mensagens: msgs.length,
      abertas: abertas.length,
      notas,
      sem_cliente: semCliente,
    });
  }),
};
