/**
 * IMP-014 — The single authoritative data-source selection boundary
 * (MIG-DS-02, API-ARCH-02).
 *
 * EVERY data-layer module resolves the active mode through getDataSource()
 * — there is exactly one VITE_DATA_SOURCE switch in the application, here.
 * The mode is validated fail-closed and cached once at startup:
 *
 *   'fixture'  — demo/sales track (TEN-20): in-memory fixtures, no backend
 *   'supabase' — production architecture (TEN-21): PostgreSQL + Auth + RLS
 *
 * Unset, empty, or unrecognized values are a hard ConfigurationError
 * (MIG-DS-05, OPS-ENV-06): there is NO default mode and NO implicit
 * fixture fallback anywhere. Once resolved, the choice never changes
 * mid-session — a runtime Supabase error surfaces as an error, never as a
 * switch to fixture (MIG-DS-06c).
 */
import { assertSupabaseConfig, parseDataSource, readDataSourceRaw } from '@/lib/env';
import type { DataSource } from '@/lib/env';

import { ConfigurationError } from './errors';

export type { DataSource } from '@/lib/env';

let resolved: DataSource | null = null;

/**
 * Resolve the active data source. Throws ConfigurationError on any
 * missing/invalid value. The result is cached: the adapter is chosen
 * once at startup and never re-evaluated (MIG-DS-02/06c).
 */
export function getDataSource(): DataSource {
  if (resolved) return resolved;
  const raw = readDataSourceRaw();
  const mode = parseDataSource(raw);
  if (!mode) {
    throw new ConfigurationError(
      `Invalid VITE_DATA_SOURCE ${JSON.stringify(raw ?? null)}: expected exactly 'fixture' or 'supabase'. ` +
        'There is no default mode and no fixture fallback (MIG-DS-05, OPS-ENV-06).',
    );
  }
  resolved = mode;
  return mode;
}

/**
 * Full startup configuration validation (OPS-ENV-06, MIG-DS-03/05):
 * the mode must be recognized AND the selected mode's configuration must
 * be complete. Called once by the application bootstrap; a failure here
 * renders the fatal configuration screen — never a blank page, never a
 * permanent spinner, never a silent fixture fallback.
 */
export function validateStartupConfig(): DataSource {
  const mode = getDataSource();
  if (mode === 'supabase') {
    try {
      assertSupabaseConfig();
    } catch (cause) {
      throw new ConfigurationError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  // fixture mode needs nothing — it is an intentional track (MIG-DS-03),
  // not an error fallback, and must never require Supabase credentials.
  return mode;
}

/** Test-only: clear the cached mode so a fresh stubbed env can resolve. */
export function __resetDataSourceForTests(): void {
  resolved = null;
}
