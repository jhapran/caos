/**
 * IMP-061 (data-adapter slice) — Structured global search: FIXTURE adapter
 * (demo track).
 *
 * Declared demo bridge (the only adapter-path file allowed to import the
 * legacy fixture modules, per tests/unit/import-boundary.test.ts
 * conventions). Fixture mode is demo-only (TEN-20); production behavior is
 * the Supabase adapter against public.structured_search.
 *
 * Demo scope note: the fixture collections have no structured
 * registrations / legal entities / compliance instances / task titles, so
 * this bridge implements the same provider-neutral contract over the demo
 * collections that have a truthful equivalent — demo clients and the demo
 * TEAM roster — with the same contract mechanics (R4 minimum length, R5
 * caps 5-per-kind / 20-global, prefix-ahead-of-substring ordering with a
 * stable id tie-break). The demo Command Palette experience itself stays
 * with the legacy searchAll() palette behavior, unchanged by IMP-061.
 * JavaScript substring matching is intrinsically literal — %, _ and
 * operator-looking input can never become wildcard syntax here.
 */
import { CLIENTS, TEAM } from '@/data/clients';

import {
  STRUCTURED_SEARCH_MIN_QUERY_LENGTH,
  type SearchMatchClass,
  type SearchService,
  type StructuredSearchHit,
} from './types';

const PER_KIND_CAP = 5;
const GLOBAL_CAP = 20;

export const fixtureSearch: SearchService = {
  mode: 'fixture',

  async searchStructured(query: string): Promise<StructuredSearchHit[]> {
    const q = query.trim().toLowerCase();
    if (q.length < STRUCTURED_SEARCH_MIN_QUERY_LENGTH) return [];

    const clients: StructuredSearchHit[] = CLIENTS.filter((c) =>
      c.name.toLowerCase().includes(q),
    )
      .map((c) => ({
        kind: 'client' as const,
        id: c.id,
        label: c.name,
        sub: `${c.industry} · ${c.city}`,
        href: `/clients/${c.id}`,
        matchClass: (c.name.toLowerCase().startsWith(q) ? 'prefix' : 'substring') as SearchMatchClass,
        status: null,
      }))
      .sort(
        (a, b) =>
          (a.matchClass === 'prefix' ? 0 : 1) - (b.matchClass === 'prefix' ? 0 : 1) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, PER_KIND_CAP);

    const staff: StructuredSearchHit[] = TEAM.filter((m) =>
      m.name.toLowerCase().includes(q),
    )
      .map((m) => ({
        kind: 'staff' as const,
        id: m.id,
        label: m.name,
        sub: `Team · ${m.role}`,
        href: null,
        matchClass: (m.name.toLowerCase().startsWith(q) ? 'prefix' : 'substring') as SearchMatchClass,
        status: null,
      }))
      .sort(
        (a, b) =>
          (a.matchClass === 'prefix' ? 0 : 1) - (b.matchClass === 'prefix' ? 0 : 1) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, PER_KIND_CAP);

    const kindRank = (h: StructuredSearchHit) => (h.kind === 'client' ? 0 : 1);
    const matchRank = (h: StructuredSearchHit) =>
      h.matchClass === 'exact' ? 0 : h.matchClass === 'prefix' ? 1 : 2;
    return [...clients, ...staff]
      .sort((a, b) => matchRank(a) - matchRank(b) || kindRank(a) - kindRank(b) || a.id.localeCompare(b.id))
      .slice(0, GLOBAL_CAP);
  },
};
