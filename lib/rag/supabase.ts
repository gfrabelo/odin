import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente Supabase (singleton lazy, só servidor).
// Usa a service role key - acesso total. NUNCA importe em componentes client.
let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
