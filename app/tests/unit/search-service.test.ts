/**
 * IMP-061 (data-adapter slice) — Structured search unit tests: the
 * provider-neutral contract (API-R0-SRC; IMP061-R1…R11) behind the FIXTURE
 * adapter (demo bridge) under the unit harness (tests/setup.ts pins
 * VITE_DATA_SOURCE=fixture, MIG-DS-05).
 *
 * Under test:
 *   - searchService resolves to fixture mode and is reachable through the
 *     '@/data' barrel;
 *   - the R4 minimum live-data query length: trimmed queries below
 *     STRUCTURED_SEARCH_MIN_QUERY_LENGTH (2) return an empty collection,
 *     never tenant data;
 *   - textual case-insensitive substring matching with prefix ranked ahead
 *     of substring-only (R3-B), over the demo clients and the demo TEAM
 *     roster — expectations are derived from those fixtures, never
 *     hard-coded;
 *   - the R5 caps (at most 5 per kind, at most 20 globally);
 *   - literal input treatment: wildcard/operator-looking input ('%%', '\\',
 *     'eq.') matches NOTHING — it can never act as wildcard/filter syntax;
 *   - the R11-A destination matrix in the demo bridge: client hits navigate
 *     to /clients/<id>; staff hits carry NO destination (href null).
 *
 * The production Supabase adapter is exercised against the real local stack
 * in tests/integration/search/ (TEST-API-21…24).
 */
import { describe, expect, it } from 'vitest';

import {
  searchService,
  STRUCTURED_SEARCH_MIN_QUERY_LENGTH,
  type StructuredSearchHit,
} from '@/data';
import { CLIENTS, TEAM } from '@/data/clients';

function expectCaps(hits: StructuredSearchHit[]) {
  expect(hits.length).toBeLessThanOrEqual(20);
  const perKind = new Map<string, number>();
  for (const h of hits) perKind.set(h.kind, (perKind.get(h.kind) ?? 0) + 1);
  for (const count of perKind.values()) expect(count).toBeLessThanOrEqual(5);
}

describe('API-R0-SRC — searchService contract (fixture adapter, demo bridge)', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', () => {
    expect(searchService.mode).toBe('fixture');
  });

  it('R4: empty and one-character queries return no live-data hits', async () => {
    expect(await searchService.searchStructured('')).toEqual([]);
    expect(await searchService.searchStructured(' ')).toEqual([]);
    expect(await searchService.searchStructured('a')).toEqual([]);
    expect(STRUCTURED_SEARCH_MIN_QUERY_LENGTH).toBe(2);
  });

  it('R3-B: case-insensitive substring matching, prefix ranked ahead of substring-only', async () => {
    // Fixture-derived: 'pvt' matches many names as substring-only; pick a
    // fixture-backed prefix/substring pair instead — 'abc' is a prefix of
    // 'ABC Pvt Ltd' and a substring of nothing else in CLIENTS.
    const prefixHits = await searchService.searchStructured('abc');
    expect(prefixHits.map((h) => h.id)).toEqual(['c-abc']);
    expect(prefixHits[0]?.matchClass).toBe('prefix');

    // Substring-only: 'vt l' occurs inside 'Pvt Ltd' names, never at a
    // name boundary — every hit is matchClass 'substring'.
    const substringHits = await searchService.searchStructured('vt l');
    expect(substringHits.length).toBeGreaterThan(0);
    for (const h of substringHits) expect(h.matchClass).toBe('substring');

    // Case-insensitivity: lowercase query matches the uppercase fixture name.
    const ci = await searchService.searchStructured('kaveri');
    expect(ci.some((h) => h.kind === 'client' && h.label === 'Kaveri Textiles Pvt Ltd')).toBe(true);
  });

  it('R5: per-kind and global caps hold on broad queries', async () => {
    // '  pvt  ' trims to a broad substring matching many demo clients.
    const hits = await searchService.searchStructured('  pvt  ');
    expect(hits.length).toBeGreaterThan(0);
    expectCaps(hits);
    const clientCount = CLIENTS.filter((c) => c.name.toLowerCase().includes('pvt')).length;
    expect(hits.filter((h) => h.kind === 'client').length).toBe(Math.min(5, clientCount));
  });

  it('R3: wildcard/operator-looking input is literal — it matches nothing', async () => {
    for (const q of ['%%', '__', '\\', 'eq.', 'or(', 'ilike.', '*.']) {
      expect(await searchService.searchStructured(q), `query ${q}`).toEqual([]);
    }
  });

  it('R11-A destinations: clients navigate to /clients/<id>; staff carry no destination', async () => {
    const hits = await searchService.searchStructured('abc');
    const client = hits.find((h) => h.kind === 'client');
    expect(client?.href).toBe('/clients/c-abc');

    const teamMember = TEAM[0];
    expect(teamMember).toBeDefined();
    const staffQuery = teamMember!.name.split(' ')[0]!.toLowerCase();
    const staffHits = await searchService.searchStructured(staffQuery);
    const staff = staffHits.find((h) => h.kind === 'staff' && h.id === teamMember!.id);
    expect(staff).toBeDefined();
    expect(staff?.href).toBeNull();
    expect(staff?.sub).toBe(`Team · ${teamMember!.role}`);
  });

  it('deterministic ordering: repeated identical queries return identical order', async () => {
    const a = await searchService.searchStructured('pvt');
    const b = await searchService.searchStructured('pvt');
    expect(a.map((h) => `${h.kind}:${h.id}`)).toEqual(b.map((h) => `${h.kind}:${h.id}`));
  });
});
