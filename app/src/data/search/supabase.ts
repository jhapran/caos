/**
 * IMP-061 (data-adapter slice) — Structured global search: SUPABASE adapter
 * (production).
 *
 * One RPC call to the SECURITY INVOKER public.structured_search(text)
 * function (migration 20260920000000_structured_search.sql, API-R0-SRC
 * R8-B). Every contract rule — min length (R4), caps (R5), deterministic
 * ordering, literal escaping (R3), identifier masking (R7), offboarded
 * truthfulness (R10), M1-A, the ACTIVE-membership staff pin (R6) and the
 * R11-A destination matrix — is enforced server-side; this adapter only
 * maps the row projection to the provider-neutral DTO.
 *
 * The active-firm selector rides on the request via the browser client's
 * x-active-firm header injection (RLS-CTX-02); it is untrusted context and
 * is revalidated against live membership by the database on every
 * statement. No firm_id argument exists and none is sent (API-CONV-05).
 *
 * R9 query privacy: the raw query is sent only as the RPC argument; it is
 * never logged, persisted, or interpolated into error messages here.
 * Errors translate once through toApiError() (API-ERR-01); no Supabase SDK
 * or PostgREST types cross this boundary. This adapter never reads fixture
 * data and never falls back to it (MIG-DS-05).
 */
import { toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { STRUCTURED_SEARCH_MIN_QUERY_LENGTH } from './types';
import type { SearchService, StructuredSearchHit } from './types';

/** Row shape of public.structured_search (snake_case). */
interface StructuredSearchRow {
  kind: StructuredSearchHit['kind'];
  id: string;
  label: string;
  sub: string | null;
  href: string | null;
  match_class: StructuredSearchHit['matchClass'];
  status: string | null;
}

export const supabaseSearch: SearchService = {
  mode: 'supabase',

  async searchStructured(query: string): Promise<StructuredSearchHit[]> {
    const q = query.trim();
    // IMP061-R4 client-side guard: never issue a live request below the
    // minimum; the database enforces the same rule again server-side.
    if (q.length < STRUCTURED_SEARCH_MIN_QUERY_LENGTH) return [];
    const { data, error } = await getSupabaseClient().rpc('structured_search', {
      p_query: q,
    });
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as StructuredSearchRow[]).map((r) => ({
      kind: r.kind,
      id: r.id,
      label: r.label,
      sub: r.sub,
      href: r.href,
      matchClass: r.match_class,
      status: r.status,
    }));
  },
};
