/**
 * IMP-051 (data-adapter slice) — Deadlines unit tests: the pure group-id
 * helpers plus the FIXTURE adapter contract (demo track) behind the
 * API-R0-DLN read model.
 *
 * Under test:
 *   - makeDeadlineGroupId / parseDeadlineGroupId (src/data/deadlines/types.ts
 *     — ONE pure implementation shared by both adapters): the
 *     '<compliance_type_id>::<YYYY-MM-DD>' drill-down address round-trips,
 *     and parse rejects malformed ids. The guarantee is exactly the
 *     separator split plus the YYYY-MM-DD digit shape — there is NO calendar
 *     validation, so 'x::2026-13-99' parses (shape-valid per the regex).
 *   - the selected service (deadlinesService via its explicit selector path)
 *     resolves to fixture mode under the unit harness (tests/setup.ts pins
 *     VITE_DATA_SOURCE=fixture, MIG-DS-05) and is reachable through the
 *     '@/data' barrel alongside the UNTOUCHED legacy deadline exports;
 *   - the fixture adapter (the declared demo bridge) derives projection A
 *     (board groups) from the legacy getDeadlineGroups() with the new
 *     production field names and the CANONICAL '<compliance_type_id>::
 *     <YYYY-MM-DD>' group id (the legacy '<complianceId>::<period label>'
 *     key is normalized at the service boundary — ONE group-ID contract
 *     for both adapters), projection B (drill-down rows) from the legacy
 *     getDeadlineClients(), and projection C (client dependency) from
 *     DEPENDENCY_CLIENTS — expectations below are derived from those legacy
 *     fixtures, never hard-coded.
 */
import { describe, expect, it } from 'vitest';

// The IMP-051 service via its explicit selector path (the barrel's wiring).
import { deadlinesService as svc } from '@/data/deadlines/deadlinesService';
import {
  DEADLINE_GROUP_ID_SEPARATOR,
  makeDeadlineGroupId,
  parseDeadlineGroupId,
} from '@/data/deadlines/types';

describe('API-R0-DLN — deadline group-id helpers (pure)', () => {
  it('makeDeadlineGroupId joins with the :: separator and parse round-trips it', () => {
    expect(DEADLINE_GROUP_ID_SEPARATOR).toBe('::');
    const id = makeDeadlineGroupId('ct-abc', '2026-09-30');
    expect(id).toBe('ct-abc::2026-09-30');
    expect(parseDeadlineGroupId(id)).toEqual({
      complianceTypeId: 'ct-abc',
      dueDate: '2026-09-30',
    });
  });

  it('parse rejects malformed ids (no separator, empty type side, bad date shape)', () => {
    expect(parseDeadlineGroupId('')).toBeNull();
    expect(parseDeadlineGroupId('foo')).toBeNull();
    expect(parseDeadlineGroupId('foo::bar')).toBeNull();
    expect(parseDeadlineGroupId('::2026-09-16')).toBeNull();
  });

  it('parse guarantees ONLY the split + YYYY-MM-DD shape — no calendar validation', () => {
    // '2026-13-99' matches the /^\d{4}-\d{2}-\d{2}$/ shape, so it parses;
    // the helper deliberately performs no month/day range validation.
    expect(parseDeadlineGroupId('x::2026-13-99')).toEqual({
      complianceTypeId: 'x',
      dueDate: '2026-13-99',
    });
  });
});

describe('fixture deadlines adapter — selection & barrel reachability', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', async () => {
    expect(svc.mode).toBe('fixture');
    const barrel = await import('@/data');
    expect(barrel.deadlinesService).toBe(svc);
    expect(typeof barrel.makeDeadlineGroupId).toBe('function');
    expect(typeof barrel.parseDeadlineGroupId).toBe('function');
    // The legacy flat module is untouched and still exported by the barrel.
    expect(typeof barrel.getDeadlineGroups).toBe('function');
    expect(typeof barrel.getDeadlineClients).toBe('function');
  });
});

describe('fixture deadlines adapter — projection A (deadline board groups)', () => {
  it('derives the groups from the legacy getDeadlineGroups() with the new field names', async () => {
    const legacy = await import('@/data/deadlines');
    const legacyGroups = legacy.getDeadlineGroups();
    const groups = await svc.listDeadlineGroups();

    expect(groups.length).toBeGreaterThan(0);
    expect(groups).toHaveLength(legacyGroups.length);

    for (const [i, g] of groups.entries()) {
      const lg = legacyGroups[i];
      expect(g).toEqual({
        // ONE canonical group-ID contract (both adapters): the legacy
        // '<complianceId>::<period label>' key is normalized to
        // '<compliance_type_id>::<YYYY-MM-DD>' at the service boundary.
        groupId: makeDeadlineGroupId(lg.complianceId, lg.dueDate),
        complianceTypeId: lg.complianceId,
        complianceName: lg.complianceName,
        dueDate: lg.dueDate,
        daysLeft: lg.daysLeft,
        totalClients: lg.totalClients,
        filed: lg.filed,
        readyToFile: lg.readyToFile,
        inProgress: lg.inProgress,
        waiting: lg.waiting,
        underReview: lg.underReview,
        notStarted: lg.notStarted,
        atRisk: lg.atRisk,
      });
      // All 8 bucket fields present (totalClients + the 7 status buckets).
      expect(typeof g.totalClients).toBe('number');
      expect(typeof g.filed).toBe('number');
      expect(typeof g.readyToFile).toBe('number');
      expect(typeof g.inProgress).toBe('number');
      expect(typeof g.waiting).toBe('number');
      expect(typeof g.underReview).toBe('number');
      expect(typeof g.notStarted).toBe('number');
      expect(typeof g.atRisk).toBe('number');
    }

    // The legacy ascending due_date order is preserved.
    const dueDates = groups.map((g) => g.dueDate);
    expect(dueDates).toEqual([...dueDates].sort((a, b) => a.localeCompare(b)));
  });
});

describe('fixture deadlines adapter — projection B (group drill-down)', () => {
  it('returns the legacy getDeadlineClients() rows with client names resolved', async () => {
    const legacy = await import('@/data/deadlines');
    const { getCompliance } = await import('@/data/compliance');
    const { daysUntil } = await import('@/data/tasks');

    const groups = await svc.listDeadlineGroups();
    const first = groups[0];
    // The service emits canonical ids; the legacy drill-down is keyed by
    // '<complianceId>::<period label>' — resolve the legacy group carrying
    // the same (compliance, dueDate) pair for the oracle.
    const legacyGroup = legacy
      .getDeadlineGroups()
      .find((g) => g.complianceId === first.complianceTypeId && g.dueDate === first.dueDate);
    expect(legacyGroup).toBeDefined();
    const legacyRows = legacy.getDeadlineClients(legacyGroup!.id);
    const rows = await svc.listDeadlineGroupInstances(first.groupId);

    expect(legacyRows.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(legacyRows.length);
    // Same order as the legacy drill-down (risk-score descending there).
    expect(rows.map((r) => r.clientId)).toEqual(legacyRows.map((r) => r.client.id));

    const masterName = getCompliance(
      first.complianceTypeId as Parameters<typeof getCompliance>[0],
    ).name;
    for (const [i, r] of rows.entries()) {
      const { task, client } = legacyRows[i];
      expect(r.clientName).not.toBeNull();
      expect(r).toMatchObject({
        id: task.id,
        clientId: client.id,
        clientName: client.name,
        complianceTypeId: task.complianceId,
        complianceName: masterName,
        periodLabel: task.period,
        state: task.state,
        dueDate: task.dueDate,
        daysLeft: daysUntil(task.dueDate),
      });
    }
  });

  it('a well-formed id with no matching demo rows is an empty collection (API-ERR-02)', async () => {
    // Genuinely WELL-FORMED under the canonical contract
    // ('<compliance_type_id>::<YYYY-MM-DD>') but UNMATCHED: a valid
    // compliance id with a date no demo group carries → empty drill-down.
    await expect(
      svc.listDeadlineGroupInstances(makeDeadlineGroupId('gstr1', '1999-01-01')),
    ).resolves.toEqual([]);
  });

  it('a malformed id is an empty collection, never an error (API-ERR-02)', async () => {
    // The fixture bridge parses the group id first (parseDeadlineGroupId)
    // and returns [] for unaddressable ids — the same collection semantics
    // as the Supabase adapter.
    await expect(svc.listDeadlineGroupInstances('malformed')).resolves.toEqual([]);
  });
});

describe('fixture deadlines adapter — projection C (client dependency)', () => {
  it('maps every DEPENDENCY_CLIENTS row as a waiting task dependency', async () => {
    const { DEPENDENCY_CLIENTS } = await import('@/data/dependency');
    const rows = await svc.listClientDependencies();

    expect(rows).toHaveLength(DEPENDENCY_CLIENTS.length);
    for (const [i, r] of rows.entries()) {
      const d = DEPENDENCY_CLIENTS[i];
      expect(r).toMatchObject({
        kind: 'task',
        id: `dep-${d.clientId}`,
        clientId: d.clientId,
        clientName: d.clientName,
        periodLabel: null,
        waitingReason: d.missingDocs.join(', '),
        status: 'waiting',
        waitingSince: d.lastReminderAt ?? null,
        ageDays: d.oldestWaitDays,
        dueDate: null,
      });
    }
    expect(rows.every((r) => r.kind === 'task')).toBe(true);
    expect(rows.every((r) => r.status === 'waiting')).toBe(true);
  });
});
