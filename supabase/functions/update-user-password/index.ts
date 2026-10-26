// supabase/functions/update-user-password/index.ts
// Edge Function: permite que um ADMIN altere a senha de login (Supabase Auth)
// de outro operador. Requer a SERVICE ROLE KEY, que NUNCA deve ir para o cliente.
//
// CONFIGURAÇÃO:
//   2. supabase functions deploy update-user-password
//   3. Garanta que o operador que chama tenha is_admin = true E auth_user_id vinculado.

import { type SupabaseContext, withSupabase } from "npm:@supabase/server@1";

// CORS e preflight ficam com o withSupabase: sem `allowedHeaders` na config,
// ele ecoa os headers pedidos no preflight — os que o supabase-js envia.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // JWT já verificado pelo withSupabase (auth: "user"); o client admin vem
  // pronto no contexto.
  const admin = ctx.supabaseAdmin;

  // 1) Quem está chamando (claims do JWT do usuário logado)
  const callerUid = ctx.userClaims?.id ?? null;
  if (!callerUid) {
    return json({ error: "Não autenticado" }, 401);
  }

  // 2) Confirmar que o chamador é administrador
  const { data: callerOp, error: callerErr } = await admin
    .from("operators")
    .select("id, is_admin, active")
    .eq("auth_user_id", callerUid)
    .maybeSingle();

  if (
    callerErr ||
    !callerOp ||
    callerOp.is_admin !== true ||
    callerOp.active === false
  ) {
    return json({ error: "Permissão negada: somente administradores" }, 403);
  }

  // 3) Ler corpo da requisição
  let userId: string;
  let password: string;
  try {
    const body = await req.json();
    userId = String(body?.userId ?? "");
    password = String(body?.password ?? "");
  } catch {
    return json({ error: "Corpo inválido" }, 400);
  }

  if (!userId || !password) {
    return json({ error: "userId e password são obrigatórios" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "A senha deve ter no mínimo 8 caracteres" }, 400);
  }

  // 4) Atualizar a senha no Supabase Auth
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error("updateUserById error:", error.message);
    return json({ error: error.message }, 500);
  }

  return json({ success: true });
}

export default { fetch: withSupabase({ auth: "user" }, handle) };
