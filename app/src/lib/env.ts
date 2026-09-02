/**
 * IMP-011/IMP-014 — Client-safe environment configuration (OPS-ENV-02).
 *
 * Only browser-safe values are read here: the publishable anon key and the
 * public project URL. Service-role credentials, database URLs, and any
 * other secret are server-only and must never be referenced from src/.
 *
 * This module is the LOW-LEVEL raw reader: it never throws at import time
 * and never decides policy. The single authoritative selection boundary is
 * `@/data/source` (MIG-DS-02): it parses, validates fail-closed
 * (MIG-DS-05), and caches the mode exactly once at startup.
 *
 * Reads are lazy (inside functions) so test harnesses can stub
 * import.meta.env before the first call.
 */

export type DataSource = 'fixture' | 'supabase';

/** Raw, unvalidated VITE_DATA_SOURCE value (undefined when unset). */
export function readDataSourceRaw(): string | undefined {
  return import.meta.env.VITE_DATA_SOURCE as string | undefined;
}

/**
 * Parse a raw DATA_SOURCE value. Whitespace-padded values are tolerated
 * (trimmed); anything other than the two exact approved mode names is
 * rejected (returns null) — the caller turns that into a hard startup
 * error (MIG-DS-05). Matching is case-sensitive on purpose: 'FIXTURE' is
 * an unrecognized value, not a mode.
 */
export function parseDataSource(raw: string | undefined): DataSource | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === 'fixture' || value === 'supabase') return value;
  return null;
}

export function readSupabaseUrl(): string | undefined {
  return import.meta.env.VITE_SUPABASE_URL as string | undefined;
}

export function readSupabaseAnonKey(): string | undefined {
  return import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
}

/**
 * Client-safe Supabase config, or null when incomplete. Policy (when
 * missing config is a hard error) lives in `@/data/source` — MIG-DS-03.
 */
export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = readSupabaseUrl();
  const anonKey = readSupabaseAnonKey();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Hard error when client-safe Supabase config is missing. Used by the
 * supabase-mode startup validation (MIG-DS-03) and the browser client
 * singleton as defense in depth. Never a fallback (MIG-PRIN-03).
 */
export function assertSupabaseConfig(): { url: string; anonKey: string } {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      'DATA_SOURCE=supabase requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (MIG-DS-03). ' +
        'No fallback is permitted.',
    );
  }
  return config;
}
