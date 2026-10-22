// The browser's connection to Supabase (accounts and saved data).
// Both values are meant to be public. Privacy comes from the database rules (Row Level Security),
// which only let a signed-in account read or change its own rows.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) throw new Error("Supabase is not set up. Add the two values to .env.local.");
  if (!client) client = createClient(url, key);
  return client;
}
