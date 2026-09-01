/**
 * IMP-011 — Client-safe environment configuration (OPS-ENV-02).
 *
 * Only browser-safe values are read here: the publishable anon key and the
 * public project URL. Service-role credentials, database URLs, and any
 * other secret are server-only and must never be referenced from src/.
 *
 * DATA_SOURCE selection (MIG-DS-01/02): 'fixture' keeps the demo track;
 * 'supabase' selects the production architecture. Unset currently means
 * 'fixture' so the demo deployment keeps working; strict fail-closed
 * startup validation for unknown/unset values (MIG-DS-05, TEST-MIG-08)
 * lands with the IMP-014 adapter skeleton. In 'supabase' mode, missing
 * URL/anon key IS a hard startup error (MIG-DS-03) — no fallback.
 */

export type DataSource = 'fixture' | 'supabase';

const raw = import.meta.env.VITE_DATA_SOURCE;

export const DATA_SOURCE: DataSource = raw === 'supabase' ? 'supabase' : 'fixture';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Hard startup error in supabase mode when client-safe config is missing. */
export function assertSupabaseConfig(): { url: string; anonKey: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'DATA_SOURCE=supabase requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (MIG-DS-03). ' +
        'No fallback is permitted.',
    );
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}
