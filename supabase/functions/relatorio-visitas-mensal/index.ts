// Relatório das visitas do mês anterior, enviado à Gestão no primeiro dia do mês.
// O pg_cron chama às 08:00 de Brasília (migration 080); avisos_enviados impede
// duplicidade quando o banco repete a chamada ou a função é testada novamente.
// Secrets: AVISOS_CRON_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD e, opcionalmente,
// GMAIL_FROM e APP_URL. Deploy: supabase functions deploy relatorio-visitas-mensal --no-verify-jwt

import { type SupabaseContext, withSupabase } from 'npm:@supabase/server@1';
import nodemailer from 'npm:nodemailer@6.9.16';
import { todayBR } from '../avisos-prazo/avisos.ts';
import {
  buildVisitsEmail,
  managerEmails,
  previousMonth,
  type Operator,
  type Visit,
} from './relatorio.ts';

const CRON_SECRET = Deno.env.get('AVISOS_CRON_SECRET') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? '';
const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = (Deno.env.get('GMAIL_APP_PASSWORD') ?? '').replace(/\s+/g, '');
const GMAIL_FROM = Deno.env.get('GMAIL_FROM') || GMAIL_USER;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handle(req: Request, ctx: SupabaseContext) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!CRON_SECRET || !safeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return json({ error: 'Não autorizado' }, 401);
  }
  const today = todayBR();
  if (!today.endsWith('-01'))
    return json({ skipped: true, reason: 'O relatório é enviado somente no primeiro dia do mês.' });
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return json({ error: 'Secrets ausentes (GMAIL_USER, GMAIL_APP_PASSWORD)' }, 500);
  }

  const db = ctx.supabaseAdmin;
  const period = previousMonth(today);
  const key = `relatorio-visitas:${period.key}`;
  const { error: claimError } = await db.from('avisos_enviados').insert({ key });
  if (claimError?.code === '23505')
    return json({ skipped: true, reason: 'Relatório já enviado.', period: period.key });
  if (claimError) return json({ error: 'avisos_enviados: ' + claimError.message }, 500);

  try {
    const { data: ops, error: opsError } = await db
      .from('operators')
      .select('email, active, is_gestao');
    if (opsError) throw new Error('operators: ' + opsError.message);
    const to = managerEmails((ops ?? []) as Operator[]);
    if (!to.length) throw new Error('Nenhum gestor ativo com e-mail cadastrado.');

    const visits: Visit[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from('visits')
        .select('id, client_name, operator, date, time, time_end, all_day, motivo, status')
        .gte('date', period.start)
        .lte('date', period.end)
        .order('date')
        .order('time')
        .range(from, from + pageSize - 1);
      if (error) throw new Error('visits: ' + error.message);
      visits.push(...((data ?? []) as Visit[]));
      if (!data || data.length < pageSize) break;
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    try {
      const mail = buildVisitsEmail(visits, period, APP_URL);
      await transporter.sendMail({
        from: { name: 'Init Intra', address: GMAIL_FROM },
        to,
        ...mail,
      });
    } finally {
      transporter.close();
    }
    return json({
      success: true,
      period: period.key,
      visits: visits.length,
      recipients: to.length,
    });
  } catch (error) {
    await db.from('avisos_enviados').delete().eq('key', key);
    console.error('relatorio-visitas-mensal:', error);
    return json({ error: (error as Error).message, period: period.key }, 500);
  }
}

export default { fetch: withSupabase({ auth: 'none' }, handle) };
