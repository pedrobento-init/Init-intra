// supabase/functions/robo/index.ts
// Edge Function: tarefas do robô Apps Script além da agenda das visitas.
// O Apps Script (tools/google-agenda-apps-script/Robo.gs) só agenda e fala
// com o Google (Agenda, Planilhas, Drive, Chat); a regra fica aqui.
//
// CONFIGURAÇÃO: usa os secrets que já existem —
//   AGENDA_SYNC_SECRET (o mesmo do robô), GMAIL_USER / GMAIL_APP_PASSWORD /
//   GMAIL_FROM (os da avisos-prazo), APP_URL (opcional).
//   supabase functions deploy robo --no-verify-jwt
//
// POST { action } com header x-agenda-secret:
//   "vencimentos" → { calendario, leitores, eventos }     agenda "Vencimentos Init"
//   "dominios"    → consulta o RDAP e grava em vencimento_dominios (059)
//   "resumo"      → envia o e-mail "Seu dia" a cada pessoa; devolve { chat }
//   "indicadores" → { abas: { nome: linhas[][] } }        planilha de indicadores
//   "backup"      → { gerado_em, tabelas, erros }         JSON para o Drive
//
//   "backups"     → { mensagens: [{ id, de, assunto, data, trecho }] } e-mails do rótulo "Backups"
//   "triagem"     → { mensagens: [...] } e-mails do rótulo "Pendências" → pendência nova
//   "pastas"      → { candidatos, vigiar, buscar } planilha sem pasta / pasta a testar e arrumar / cliente sem pasta nem planilha
//   "pastas-resultado" { achados, testes, erros, ambiguas, orfas } → { gravados, atualizados }
//
// RESUMO: um por pessoa por dia (chave em avisos_enviados, 051); dia sem
// nada não manda e-mail; sábado/domingo só para quem tem visita. Cada visita
// leva o briefing do cliente (060); com IA_WEBHOOK_URL, mais o texto da
// IA (Make), guardado em visits.briefing_ia para o app mostrar.
// BACKUPS: o e-mail acha o monitor pelo identificador; falha ou silêncio
// além de max_horas abre pendência (uma por vez: só abre outra quando a
// anterior foi fechada).
// TRIAGEM: e-mail do cliente (domínio da ficha ou nome no assunto) vira
// pendência com canal "email" e a etiqueta "triagem-automatica"; o IA_WEBHOOK_URL
// (Make) classifica assunto, descrição, tipo, prioridade e categoria. Sem o
// Make — ou com ele fora do ar — a pendência abre com o texto do próprio
// e-mail. Uma por mensagem (chave em avisos_enviados). E-mail de quem não é
// cliente, e e-mail que a IA marcou `ignorar`, não abrem chamado mas ficam na
// caixa de triagem (066) para alguém olhar — antes sumiam em silêncio.
// BACKUP: sem segredos (token Milvus do cliente, PIN dos operadores) e sem
// as tabelas de credenciais/sincronização.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { type Operator, todayBR } from "../avisos-prazo/avisos.ts";
import {
  dominioDe, type Dominio, expiracaoRdap, type Hora, montarIndicadores, montarResumos, type Pend,
  resumoChat, type Venc, vencimentoEvento, type Visita,
} from "./relatorios.ts";
import {
  aplicarEmail, backupAlerta, briefingDados, briefingHtml, briefingTemConteudo, briefingTexto, classificarBackup,
  type Cliente, clienteDoEmail, corpoLimpo, type Device, dominiosInternos, type EmailBackup, type EmailEntrada,
  enderecoDoRemetente, entradaNaoAproveitada, gravarResultadoPastas, marcarPastasInvalidas, type ClientePasta, planoPastas,
  type Monitor, monitorDoEmail, type MotivoNaoAproveitado, notaDoSolicitante, pendenciaDaTriagem, pendenciaDoAlerta,
  remetenteInterno, respostaAutomatica, textoDaIa, triagemDaIa,
} from "./campo.ts";

const SECRET = Deno.env.get("AGENDA_SYNC_SECRET") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
const GMAIL_USER = Deno.env.get("GMAIL_USER") ?? "";
const GMAIL_APP_PASSWORD = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || GMAIL_USER;
// Cenário único do Make (GOOGLE-AGENDA.md → "IA pelo Make"): o campo "tarefa"
// escolhe a rota. "briefing" devolve o parágrafo da visita; sem ele, o briefing
// sai só com os fatos. "triagem" devolve a classificação do e-mail; sem ela, a
// pendência abre com o texto do próprio e-mail.
const IA_WEBHOOK_URL = Deno.env.get("IA_WEBHOOK_URL") ?? "";

// Tabela → colunas tiradas do backup (segredos).
const BACKUP: Record<string, string[]> = {
  clients: ["milvus_client_token"],
  operators: ["pin_hash", "pin_salt"],
  pendencias: [], visits: [], vencimentos: [], time_entries: [], procedures: [], procedure_templates: [],
  reunioes: [], equipamentos: [], checklists: [], checklist_modelo_itens: [], checklist_marcacoes: [],
  client_devices: [], client_milvus_tickets: [], milvus_client_map: [], levar_regras: [], audit_logs: [],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function all<T>(db: SupabaseClient, table: string, cols = "*", filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const OPS_COLS = "id, name, email, active, is_admin, is_gestao";
const VIS_COLS = "id, numero, client_id, client_name, operator, operator_id, date, time, time_end, all_day, motivo, status, levar";
const PEN_COLS = "id, assunto, descricao, client_name, responsible, responsible_id, priority, status, tipo, deadline, categoria, canal, created_at, completed_at, first_response_due, first_response_at";
const VENC_COLS = "id, tipo, descricao, client_name, data_vencimento, responsavel, responsavel_id, renovacao_auto, status, observacoes";

async function vencimentos(db: SupabaseClient) {
  const [ops, vencs] = await Promise.all([
    all<Operator>(db, "operators", OPS_COLS),
    all<Venc>(db, "vencimentos", VENC_COLS, (q) => q.neq("status", "encerrado")),
  ]);
  return json({
    calendario: "Vencimentos Init",
    leitores: ops.filter((o) => o.active !== false && o.email).map((o) => o.email!.trim().toLowerCase()),
    eventos: vencs.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(String(v.data_vencimento || ""))).map((v) => vencimentoEvento(v, APP_URL)),
  });
}

async function dominios(db: SupabaseClient) {
  const vencs = await all<Venc>(db, "vencimentos", VENC_COLS, (q) => q.eq("tipo", "dominio").neq("status", "encerrado"));
  const out: Dominio[] = [];
  for (const v of vencs) {
    const dominio = dominioDe(v);
    let expira: string | null = null, erro: string | null = null;
    if (!dominio) {
      erro = "Domínio não encontrado na descrição (ex.: escreva cliente.com.br)";
    } else {
      try {
        // rdap.org encaminha para o registro certo (.br → registro.br).
        const res = await fetch("https://rdap.org/domain/" + encodeURIComponent(dominio), {
          headers: { Accept: "application/rdap+json" }, signal: AbortSignal.timeout(10000),
        });
        if (res.status === 404) erro = "Domínio não encontrado no registro";
        else if (!res.ok) erro = "Registro respondeu " + res.status;
        else { expira = expiracaoRdap(await res.json()); if (!expira) erro = "Registro não informa a expiração"; }
      } catch (e) {
        erro = "Falha ao consultar: " + String((e as Error).message).slice(0, 120);
      }
    }
    const row = { vencimento_id: v.id, dominio: dominio || "", expira_registro: expira, erro, verificado_em: new Date().toISOString() };
    await db.from("vencimento_dominios").upsert(row);
    out.push(row);
  }
  return json({ success: true, verificados: out.length, dominios: out });
}

async function resumo(db: SupabaseClient, input: { enviar?: unknown }) {
  const today = todayBR();
  const [ops, visitas, pendencias, vencs, doms] = await Promise.all([
    all<Operator>(db, "operators", OPS_COLS),
    all<Visita>(db, "visits", VIS_COLS, (q) => q.eq("date", today)),
    all<Pend>(db, "pendencias", PEN_COLS, (q) => q.lte("deadline", today)),
    all<Venc>(db, "vencimentos", VENC_COLS, (q) => q.neq("status", "encerrado")),
    all<Dominio>(db, "vencimento_dominios", "vencimento_id, dominio, expira_registro, erro").catch(() => [] as Dominio[]),
  ]);
  const chat = resumoChat({ today, ops, visitas, pendencias, vencimentos: vencs });
  if (input.enviar === false) return json({ success: true, enviados: 0, chat });
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return json({ error: "Gmail não configurado (GMAIL_USER/GMAIL_APP_PASSWORD)" }, 500);

  const briefings = await montarBriefings(db, today, visitas.filter((v) => v.status !== "cancelada"), vencs).catch((e) => {
    console.error("robo briefing:", (e as Error).message);  // briefing é extra: o resumo sai sem ele
    return new Map<string, string>();
  });
  const cliIds = [...new Set(visitas.map((v) => (v as VisitaHoje).client_id).filter(Boolean))] as string[];
  const clis = cliIds.length ? await all<{ id: string; name: string; address: string | null }>(db, "clients", "id, name, address", (q) => q.in("id", cliIds)).catch(() => []) : [];
  const paradas = new Map(visitas.map((v) => {
    const c = clis.find((x) => x.id === (v as VisitaHoje).client_id);
    return [v.id, (c && String(c.address || "").trim()) || (c && c.name) || v.client_name || ""] as [string, string];
  }));
  const fimDeSemana = [0, 6].includes(new Date(today + "T12:00:00Z").getUTCDay());
  const resumos = montarResumos({ today, ops, visitas, pendencias, vencimentos: vencs, dominios: doms, appUrl: APP_URL, briefings, paradas })
    .filter((r) => !r.vazio && (!fimDeSemana || r.visitasHoje > 0));
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  let enviados = 0;
  const falhas: string[] = [];
  try {
    for (const r of resumos) {
      const key = `resumo:${today}:${r.op.id}`;
      const { error } = await db.from("avisos_enviados").insert({ key });
      if (error) { if (error.code === "23505") continue; throw new Error("avisos_enviados: " + error.message); }
      try {
        await transporter.sendMail({ from: { name: "Init Intra", address: GMAIL_FROM }, to: r.op.email!, subject: r.subject, html: r.html });
        enviados++;
      } catch (e) {
        await db.from("avisos_enviados").delete().eq("key", key);  // tenta de novo na próxima chamada
        falhas.push(`${r.op.id}: ${(e as Error).message}`);
      }
    }
  } finally {
    transporter.close();
  }
  if (falhas.length) console.error("robo resumo falhas:", falhas);
  return json({ success: true, enviados, falhas: falhas.length, chat });
}

type VisitaHoje = Visita & { client_id?: string | null; observacoes?: string | null; briefing_ia?: string | null; briefing_em?: string | null };

/** Briefing de cada visita de hoje (fatos + IA do Make, uma vez por dia). */
async function montarBriefings(db: SupabaseClient, today: string, visitas: Visita[], vencs: Venc[]) {
  const out = new Map<string, string>();
  const ids = visitas.map((v) => v.id);
  if (!ids.length) return out;
  const { data: hoje, error } = await db.from("visits").select(VIS_COLS + ", observacoes, briefing_ia, briefing_em").in("id", ids);
  if (error) throw new Error("visits: " + error.message);
  const clientes = [...new Set((hoje || []).map((v: VisitaHoje) => v.client_id).filter(Boolean))] as string[];
  if (!clientes.length) return out;
  const [hist, pends, devs, mons] = await Promise.all([
    all<Visita & { client_id: string; relatorio: string }>(db, "visits", "id, client_id, date, motivo, status, relatorio", (q) => q.in("client_id", clientes).eq("status", "concluida")),
    all<Pend & { client_id: string }>(db, "pendencias", PEN_COLS + ", client_id", (q) => q.in("client_id", clientes)),
    all<Device & { client_id: string }>(db, "client_devices", "client_id, hostname, apelido, is_ativo, data_ultima_atualizacao, updated_at", (q) => q.in("client_id", clientes)),
    all<Monitor>(db, "backup_monitores", "*", (q) => q.in("client_id", clientes)).catch(() => [] as Monitor[]),
  ]);
  const vencCli = await all<Venc & { client_id: string }>(db, "vencimentos", VENC_COLS + ", client_id", (q) => q.in("client_id", clientes).neq("status", "encerrado"))
    .catch(() => vencs as (Venc & { client_id: string })[]);
  for (const v of (hoje || []) as VisitaHoje[]) {
    const c = v.client_id;
    if (!c) continue;
    const dados = briefingDados(v, {
      today, visitas: hist.filter((x) => x.client_id === c), pendencias: pends.filter((x) => x.client_id === c),
      vencimentos: vencCli.filter((x) => x.client_id === c), devices: devs.filter((x) => x.client_id === c),
      monitores: mons.filter((x) => x.client_id === c),
    });
    if (!briefingTemConteudo(dados)) continue;
    let ia = v.briefing_em && String(v.briefing_em).slice(0, 10) === today ? v.briefing_ia || null : null;
    if (!ia && IA_WEBHOOK_URL) {
      try {
        const res = await fetch(IA_WEBHOOK_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tarefa: "briefing", visita_id: v.id, contexto: briefingTexto(dados) }), signal: AbortSignal.timeout(25000),
        });
        ia = res.ok ? textoDaIa(await res.text()) : null;
        if (ia) await db.from("visits").update({ briefing_ia: ia, briefing_em: new Date().toISOString() }).eq("id", v.id);
      } catch (e) {
        console.error(`robo briefing IA ${v.id}:`, (e as Error).message);
      }
    }
    out.set(v.id, briefingHtml(dados, ia));
  }
  return out;
}

/** E-mails que o Apps Script mandou, do mais antigo para o mais novo. */
function emailsDaEntrada(input: { mensagens?: unknown }, max: number): EmailBackup[] {
  return (Array.isArray(input.mensagens) ? input.mensagens : []).slice(0, max)
    .filter((m): m is EmailBackup => !!m && typeof m.id === "string" && typeof m.assunto === "string" && !isNaN(Date.parse(m.data)))
    .map((m) => ({ ...m, de: String(m.de || ""), trecho: String(m.trecho || "").slice(0, 2000) }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

async function backups(db: SupabaseClient, input: { mensagens?: unknown }) {
  const msgs = emailsDaEntrada(input, 500);
  const mons = new Map((await all<Monitor>(db, "backup_monitores", "*")).map((m) => [m.id, m]));
  const mudou = new Set<string>();
  let casadas = 0;
  for (const e of msgs) {
    const m = monitorDoEmail([...mons.values()], e);
    const st = m && classificarBackup(e.assunto, e.trecho);
    if (!m || !st) continue;
    casadas++;
    mons.set(m.id, aplicarEmail(mons.get(m.id)!, e, st));
    mudou.add(m.id);
  }

  // Alertas: uma pendência por vez por monitor.
  const agora = new Date();
  const abertas = [...mons.values()].map((m) => m.pendencia_id).filter(Boolean) as string[];
  const { data: pens } = abertas.length
    ? await db.from("pendencias").select("id, status").in("id", abertas)
    : { data: [] as { id: string; status: string }[] };
  const fechada = (id: string) => {
    const p = (pens || []).find((x) => x.id === id);
    return !p || ["concluido", "resolvido", "cancelado", "fechado"].includes(String(p.status));
  };
  let alertas = 0;
  for (const m of mons.values()) {
    const a = backupAlerta(m, agora);
    if (!a || (m.pendencia_id && !fechada(m.pendencia_id))) continue;
    const pen = pendenciaDoAlerta(m, a, "PEN-" + crypto.randomUUID(), agora);
    const { error } = await db.from("pendencias").insert(pen);
    if (error) { console.error(`robo backup pendência ${m.id}:`, error.message); continue; }
    m.pendencia_id = pen.id;
    mudou.add(m.id);
    alertas++;
  }
  for (const id of mudou) {
    const m = mons.get(id)!;
    await db.from("backup_monitores").update({
      ultimo_status: m.ultimo_status, ultimo_em: m.ultimo_em, ultimo_assunto: m.ultimo_assunto,
      historico: m.historico || [], pendencia_id: m.pendencia_id, updated_at: agora.toISOString(),
    }).eq("id", id);
  }
  return json({ success: true, mensagens: msgs.length, casadas, alertas });
}

// Mesma lista de PEN_CLOSED_FOR_COUNT (campo.ts) e de isPendenciaClosed no app.
const PEN_FECHADOS = ["concluido", "resolvido", "cancelado", "fechado"];

/** Classificação do e-mail pelo Make; falhou ou não tem webhook, devolve "" (vale o e-mail). */
async function classificarComIa(e: EmailEntrada, c: Cliente): Promise<string> {
  if (!IA_WEBHOOK_URL) return "";
  try {
    const res = await fetch(IA_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tarefa: "triagem", email_id: e.id, de: e.de, assunto: e.assunto, data: e.data,
        // Vai o corpo limpo, não o e-mail cru: a IA classifica o que a pessoa
        // escreveu agora, e a conversa citada deixa de passar pelo Make.
        trecho: corpoLimpo(e.trecho || "").slice(0, 2000), cliente: c.name || "",
      }),
      signal: AbortSignal.timeout(25000),
    });
    return res.ok ? await res.text() : "";
  } catch (err) {
    console.error(`robo triagem IA ${e.id}:`, (err as Error).message);
    return "";
  }
}

/**
 * Chamado ABERTO que esta conversa já abriu, ou null.
 *
 * Fechado não conta: uma resposta depois de concluir é um pedido novo, e
 * ressuscitar o chamado antigo esconderia isso do SLA e da fila. A busca é
 * pelo id da conversa (índice parcial da migration 065); sem a coluna no
 * banco, o erro volta aqui e a triagem segue abrindo chamado novo.
 */
async function chamadoDaConversa(db: SupabaseClient, threadId: string) {
  const t = String(threadId || "").trim();
  if (!t) return null;
  const { data, error } = await db.from("pendencias")
    .select("id, status, notes, solicitante_email")
    .eq("email_thread_id", t)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("robo triagem thread:", error.message);  // banco sem a 065
    return null;
  }
  const aberto = (data || []).find((p) => !PEN_FECHADOS.includes(String(p.status)));
  return aberto || null;
}


/**
 * Guarda na caixa de triagem (066) o e-mail que não virou chamado.
 *
 * `team` vem do cliente no caminho ignorado_ia: a entrada da mam/bt tem de
 * aparecer na caixa da mam/bt, senão some para quem é de lá. Sem cliente
 * (sem_cliente) não há equipe para herdar — a 066 traz o padrão.
 *
 * Banco sem a 066 não derruba a triagem: o resto da rodada vale, e os
 * chamados de quem É cliente continuam abrindo. A chave de dedupe NÃO volta
 * para a fila neste erro — devolvê-la fazia a mesma mensagem ser
 * reprocessada e reclassificada toda rodada enquanto o insert falhasse
 * (com a 066 ausente, para sempre: gasto de IA no caminho ignorado_ia e o
 * mesmo erro no log a cada ciclo). A mensagem é consumida e o erro fica no
 * log, alto de propósito: 066 é obrigatória no deploy.
 */
async function guardarEntrada(
  db: SupabaseClient,
  e: EmailEntrada,
  motivo: MotivoNaoAproveitado,
  team = "init",
): Promise<boolean> {
  const linha = entradaNaoAproveitada(e, motivo, "ETR-" + crypto.randomUUID(), team);
  const { error } = await db.from("emails_triagem").insert(linha);
  if (!error) return true;
  // Já registrado: a rodada anterior gravou e caiu antes de seguir.
  if (error.code === "23505") return true;
  console.error(`robo triagem caixa ${e.id} (a mensagem NÃO apareceu na caixa):`, error.message);
  return false;
}

async function triagem(db: SupabaseClient, input: { mensagens?: unknown }) {
  const msgs = emailsDaEntrada(input, 100);
  if (!msgs.length) return json({ success: true, mensagens: 0, abertas: 0, ignorados: 0, internos: 0, notas: 0, auto_respostas: 0, sem_cliente: [] });
  const clientes = await all<Cliente>(db, "clients", "id, name, team, technician, emails");
  const abertas: string[] = [], semCliente: string[] = [];
  const dominios = dominiosInternos(GMAIL_USER);
  let ignorados = 0, internos = 0, notas_em_aberto = 0, auto_respostas = 0;
  for (const e of msgs) {
    // O robô varre a CONVERSA inteira do rótulo: a nossa própria resposta ao
    // cliente chega aqui como mensagem nova. Ela não é pedido novo — abria um
    // chamado com o técnico como solicitante, e responder ali devolveria o
    // e-mail para a própria Init. Sai antes de tocar no banco.
    if (remetenteInterno(e.de, dominios)) { internos++; continue; }
    // Uma pendência por mensagem, mesmo que o robô mande o e-mail duas vezes.
    const key = `triagem:${e.id}`;
    const { error } = await db.from("avisos_enviados").insert({ key });
    if (error) { if (error.code === "23505") continue; throw new Error("avisos_enviados: " + error.message); }
    // Antes da conversa e da IA: auto-resposta na conversa de um chamado
    // virava nota do solicitante (e podia ecoar com a nossa resposta), e fora
    // dela gastava uma chamada ao Make para ser ignorada. Vai para a caixa,
    // na equipe do cliente quando dá para saber qual é.
    if (respostaAutomatica(e)) {
      auto_respostas++;
      await guardarEntrada(db, e, "auto_resposta", clienteDoEmail(clientes, e)?.team || "init");
      continue;
    }
    // Mensagem numa conversa que já abriu chamado: é a MESMA história, e um
    // chamado por e-mail deixava quem atende com dois pela metade. Vira nota
    // ali. Não passa pela IA: não há nada a classificar numa conversa que já
    // tem assunto, cliente e prioridade — e é uma chamada a menos ao Make.
    const aberto = await chamadoDaConversa(db, e.thread_id || "");
    if (aberto) {
      const notas = Array.isArray(aberto.notes) ? aberto.notes : [];
      const agora = new Date().toISOString();
      const patch: Record<string, unknown> = {
        notes: [...notas, notaDoSolicitante(e)],
        updated_at: agora,
      };
      // A resposta da tela sai em cima da ÚLTIMA mensagem da conversa: sem
      // isto o In-Reply-To apontaria para o e-mail que abriu o chamado, lá
      // atrás, e alguns clientes de e-mail desgrudam a conversa.
      const mid = String(e.message_id || "").trim().slice(0, 500);
      if (mid) patch.email_message_id = mid;
      // Chamado antigo pode não ter endereço (aberto antes da 064).
      if (!aberto.solicitante_email) {
        const end = enderecoDoRemetente(e.de);
        if (end) patch.solicitante_email = end;
      }
      const { error: erroNota } = await db.from("pendencias").update(patch).eq("id", aberto.id);
      if (erroNota) {
        await db.from("avisos_enviados").delete().eq("key", key);  // tenta de novo depois
        console.error(`robo triagem nota ${e.id}:`, erroNota.message);
        continue;
      }
      notas_em_aberto++;
      continue;
    }
    const c = clienteDoEmail(clientes, e);
    if (!c) {
      // Antes isto era só `semCliente.push(assunto)`: o e-mail sumia e o
      // assunto ia para um JSON que ninguém lê. Domínio fora da ficha e Gmail
      // pessoal (que nunca casa, de propósito) são pedido de cliente tanto
      // quanto os outros — agora ficam na caixa de triagem (066).
      semCliente.push(String(e.assunto || "").slice(0, 80));
      await guardarEntrada(db, e, "sem_cliente");
      continue;
    }
    const t = triagemDaIa(await classificarComIa(e, c), e);
    if (t.ignorar) {
      // Propaganda, aviso automático, agradecimento — e, quando o Make erra,
      // um pedido de verdade. Virar contador escondia o erro da IA; agora a
      // mensagem fica para alguém conferir.
      ignorados++;
      // Com cliente na mão, a entrada nasce na equipe dele: senão a caixa da
      // mam/bt nunca veria o que a IA ignorou de um cliente da mam/bt.
      await guardarEntrada(db, e, "ignorado_ia", c.team);
      continue;
    }
    const pen = pendenciaDaTriagem(t, e, c, "PEN-" + crypto.randomUUID(), new Date());
    const { error: erroPen } = await db.from("pendencias").insert(pen);
    if (erroPen) {
      await db.from("avisos_enviados").delete().eq("key", key);  // tenta de novo na próxima chamada
      console.error(`robo triagem pendência ${e.id}:`, erroPen.message);
      continue;
    }
    abertas.push(pen.id);
  }
  return json({ success: true, mensagens: msgs.length, abertas: abertas.length, ignorados, internos,
    notas: notas_em_aberto, auto_respostas, sem_cliente: semCliente });
}

async function indicadores(db: SupabaseClient) {
  const [ops, visitas, pendencias, horas, clientes] = await Promise.all([
    all<Operator>(db, "operators", OPS_COLS),
    all<Visita>(db, "visits", VIS_COLS),
    all<Pend>(db, "pendencias", PEN_COLS),
    all<Hora>(db, "time_entries", "id, operator_id, operator_name, client_id, started_at, ended_at, seconds, source, note").catch(() => [] as Hora[]),
    all<{ id: string; name: string }>(db, "clients", "id, name"),
  ]);
  return json({ abas: montarIndicadores({ ops, visitas, pendencias, horas, clientes }), atualizado_em: new Date().toISOString() });
}

async function backup(db: SupabaseClient) {
  const tabelas: Record<string, unknown[]> = {};
  const erros: Record<string, string> = {};
  for (const [t, tirar] of Object.entries(BACKUP)) {
    try {
      const rows = await all<Record<string, unknown>>(db, t);
      tabelas[t] = tirar.length ? rows.map((r) => { const c = { ...r }; for (const k of tirar) delete c[k]; return c; }) : rows;
    } catch (e) {
      erros[t] = String((e as Error).message).slice(0, 200);  // tabela que não existe neste banco
    }
  }
  return json({ gerado_em: new Date().toISOString(), tabelas, erros });
}

// PASTAS: o plano é refeito do banco nas duas chamadas; o robô só diz o que o Drive respondeu.
const planoDoBanco = async (db: SupabaseClient) =>
  planoPastas(await all<ClientePasta>(db, "clients", "id, name, cnpj, google_sheet_url, drive_folder_url"));

async function pastas(db: SupabaseClient) {
  const plano = await planoDoBanco(db);
  const log = await marcarPastasInvalidas(db, plano.invalidos, new Date().toISOString());
  if (log) console.warn("robo pastas:", log);
  return json({ candidatos: plano.candidatos, vigiar: plano.vigiar, buscar: plano.buscar });
}

async function pastasResultado(db: SupabaseClient, input: { achados?: unknown; testes?: unknown; erros?: unknown; ambiguas?: unknown; orfas?: unknown }) {
  const r = await gravarResultadoPastas(db, await planoDoBanco(db), input, new Date().toISOString());
  if (r.log) console.warn("robo pastas:", r.log);
  if (Array.isArray(input.erros) && input.erros.length) console.warn("robo pastas: erros do Drive", input.erros.slice(0, 20));
  // Nada disso vira dado: o robô não decide entre pastas de mesmo nome nem apaga órfã — fica no log para alguém olhar.
  if (Array.isArray(input.ambiguas) && input.ambiguas.length) console.warn("robo pastas: ambíguas", input.ambiguas.slice(0, 20));
  if (Array.isArray(input.orfas) && input.orfas.length) console.warn("robo pastas: órfãs", input.orfas.slice(0, 20));
  return json({ gravados: r.gravados, atualizados: r.atualizados });
}

// auth: "none" desliga só a checagem de JWT da plataforma: quem chama é o Apps
// Script, que não tem JWT. O x-agenda-secret continua sendo o primeiro teste.
async function handle(req: Request, ctx: SupabaseContext) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SECRET || !safeEqual(req.headers.get("x-agenda-secret") ?? "", SECRET)) return json({ error: "Não autorizado" }, 401);

  let input: { action?: string; enviar?: unknown; mensagens?: unknown; achados?: unknown; testes?: unknown; erros?: unknown; ambiguas?: unknown; orfas?: unknown };
  try { input = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const db = ctx.supabaseAdmin;
  try {
    switch (input.action) {
      case "vencimentos": return await vencimentos(db);
      case "dominios": return await dominios(db);
      case "resumo": return await resumo(db, input);
      case "indicadores": return await indicadores(db);
      case "backup": return await backup(db);
      case "backups": return await backups(db, input);
      case "triagem": return await triagem(db, input);
      case "pastas": return await pastas(db);
      case "pastas-resultado": return await pastasResultado(db, input);
      default: return json({ error: "Ação desconhecida" }, 400);
    }
  } catch (e) {
    console.error("robo:", input.action, (e as Error).message);
    return json({ error: "Falha no servidor" }, 500);
  }
}

export default { fetch: withSupabase({ auth: "none" }, handle) };
