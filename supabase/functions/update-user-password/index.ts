// supabase/functions/update-user-password/index.ts
// Edge Function: permite que um ADMIN altere a senha de login (Supabase Auth)
// de outro operador. Requer a SERVICE ROLE KEY, que NUNCA deve ir para o cliente.
//
// CONFIGURAÇÃO:
//   1. supabase secrets set SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx
//   2. supabase functions deploy update-user-password
//   3. Garanta que o operador que chama tenha is_admin = true E auth_user_id vinculado.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY não configurada");
    return json({ error: "Service role key não configurada" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Identificar quem está chamando (JWT do usuário logado)
  let callerUid: string | null = null;
  if (callerToken) {
    const { data } = await admin.auth.getUser(callerToken);
    callerUid = data?.user?.id ?? null;
  }
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
});
