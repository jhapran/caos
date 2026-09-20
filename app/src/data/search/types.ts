/**
 * IMP-061 (data-adapter slice) — Structured global search: provider-neutral
 * domain types for the API-R0-SRC contract (IMP061-R1…R11, M1-A).
 *
 * One hit shape behind the ⌘K Command Palette. R11-A (OPTIONAL TRUTHFUL
 * NAVIGATION): `href` is nullable — task / compliance_instance / staff hits
 * carry NO destination in R0 and must render non-navigable; client /
 * legal_entity / registration hits navigate to `/clients/:clientId` (entity
 * and registration via the authorized parent Client 360 surface).
 *
 * Identifier privacy (R7): registration hits display the masked identifier
 * (type + last four) in `label`; the raw value is never part of this DTO.
 *
 * Collection semantics are API-ERR-02: an empty scope or a sub-minimum
 * query is an empty collection, never an error.
 */

/** Exactly the six approved searchable kinds (IMP061-R1). Page/navigation
 *  shortcuts stay a client-side palette concern, never a service result. */
export type StructuredSearchKind =
  | 'client'
  | 'legal_entity'
  | 'registration'
  | 'task'
  | 'compliance_instance'
  | 'staff';

/** Match class carried for deterministic client handling (IMP061-R3/R5):
 *  identifier exact / identifier prefix-or-textual prefix / substring-only. */
export type SearchMatchClass = 'exact' | 'prefix' | 'substring';

/** Server-side minimum live-data query length (IMP061-R4). The palette must
 *  not issue live searches below this; the database function enforces it
 *  again server-side. */
export const STRUCTURED_SEARCH_MIN_QUERY_LENGTH = 2;

/** One structured-search hit (provider-neutral DTO, API-CONV-01). */
export interface StructuredSearchHit {
  kind: StructuredSearchKind;
  id: string;
  label: string;
  /** Secondary/context line; null when no truthful context exists. */
  sub: string | null;
  /** R11-A optional navigation destination; null = non-navigable hit. */
  href: string | null;
  matchClass: SearchMatchClass;
  /** Truthful status for badge rendering (e.g. client 'offboarded',
   *  IMP061-R10); null when no status badge applies. */
  status: string | null;
}

import type { DataSource } from '@/data/source';

/**
 * The provider-neutral structured-search contract (API-R0-SRC). Two
 * implementations (fixture demo bridge / Supabase production) sit behind
 * this interface; consumers import `searchService` from `@/data`.
 *
 * Read-only: there is NO write surface. The production adapter calls the
 * SECURITY INVOKER public.structured_search(text) function — ordinary
 * caller RLS remains authoritative and is never widened (IMP061-R6/R8).
 */
export interface SearchService {
  readonly mode: DataSource;

  /** Structured global search over the six approved domains. Implementations
   *  enforce the R4 minimum length, the R5 caps (5 per kind / 20 global) and
   *  the deterministic ordering; a trimmed query below the minimum returns
   *  an empty collection, never tenant data and never an error. */
  searchStructured(query: string): Promise<StructuredSearchHit[]>;
}
