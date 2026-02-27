import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CreateUserPayload = {
  email: string;
  role?: "user" | "admin";
  full_name?: string;
  phone?: string;
  job_title?: string;
};

const generatePassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !supabaseAnon || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase environment secrets." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: roleError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();

    if (roleError || profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can create users." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (await req.json()) as CreateUserPayload;
    if (!payload.email) {
      return new Response(JSON.stringify({ error: "Missing email." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const role = payload.role === "admin" ? "admin" : "user";
    const password = generatePassword();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await adminClient.auth.admin.createUser({
      email: payload.email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        role,
        full_name: payload.full_name?.trim() || null,
        phone: payload.phone?.trim() || null,
        job_title: payload.job_title?.trim() || null,
        must_change_password: true,
      },
      app_metadata: { role },
    });

    if (error || !data.user?.id) {
      return new Response(JSON.stringify({ error: error?.message || "Unable to create user." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: data.user.id,
      email: payload.email.trim().toLowerCase(),
      role,
      full_name: payload.full_name?.trim() || null,
      phone: payload.phone?.trim() || null,
      job_title: payload.job_title?.trim() || null,
    });

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user_id: data.user.id,
        email: payload.email.trim().toLowerCase(),
        password,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
