/**
 * IMP-011/IMP-014 — Central Supabase browser client (the ONLY browser client).
 *
 * Initialized lazily, exactly once, only in supabase mode. Components and
 * pages must never create their own client or reference Supabase directly —
 * they go through the @/data adapters. Browser-safe configuration only
 * (OPS-ENV-02): publishable anon key + public URL, never a service role.
 *
 * Hard guard (MIG-DS-06): calling this in fixture mode is a programming
 * error and throws — fixture mode must never instantiate a Supabase
 * client or make Supabase network calls.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getActiveFirm } from '@/data/context';
import { getDataSource } from '@/data/source';
import { assertSupabaseConfig } from '@/lib/env';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (getDataSource() !== 'supabase') {
    throw new Error(
      'getSupabaseClient() is only available in DATA_SOURCE=supabase mode; ' +
        'fixture mode never initializes a Supabase client (MIG-DS-06).',
    );
  }
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
      global: {
        // Inject the active-firm SELECTOR header (RLS-CTX-01) on every
        // request — including auth calls, where it is simply ignored. The
        // header is untrusted context: the database validates it against
        // the caller's live membership on every statement, so a forged or
        // stale selection can never widen access (DEC-J).
        fetch: (input, init) => {
          const firmId = getActiveFirm();
          if (!firmId) return fetch(input, init);
          const headers = new Headers(init?.headers);
          headers.set('x-active-firm', firmId);
          return fetch(input, { ...init, headers });
        },
      },
    });
  }
  return client;
}
