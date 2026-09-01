/**
 * IMP-011 — Central Supabase browser client (the ONLY browser client).
 *
 * Initialized lazily, exactly once, only in supabase mode. Components and
 * pages must never create their own client or reference Supabase directly —
 * they go through the @/data/auth adapter. Browser-safe configuration only
 * (OPS-ENV-02): publishable anon key + public URL, never a service role.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { assertSupabaseConfig } from './env';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = assertSupabaseConfig();
    client = createClient(url, anonKey, {
      auth: {
        // Session policy targets (AUTH-08) are enforced server-side
        // (GoTrue config); the browser client just persists and refreshes.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
