/**
 * IMP-042 (data-adapter slice) — My Work unit tests: the DEC-L bucket
 * semantics as pure-logic tests (TEST-API-19 logic portion) plus the
 * fixture adapter contract (demo track).
 *
 * The DEC-L rules under test (all in the shared pure layer,
 * src/data/mywork/types.ts — ONE implementation used by both adapters):
 *   - Asia/Kolkata business-date boundaries: Today is due_date <= the
 *     business date (overdue-inclusive); This Week is due_date > the
 *     business date and <= the end of the current ISO week, inclusive;
 *     due_date NULL is excluded from both date buckets;
 *   - single-bucket precedence Returned → Waiting → Today → This Week (an
 *     item matching multiple buckets appears in exactly one);
 *   - canonical-work-identity deduplication and the Returned markers
 *     (adapters canonicalize; the pure layer enforces the precedence);
 *   - next_action rules: the standalone returned ReviewItem carries exactly
 *     "Address reviewer feedback"; reviewer rationale is never next_action;
 *   - sort: due_date ASC NULLS LAST, then the existing priority order
 *     highest-first, then stable ID tie-break;
 *   - the fixture adapter derives the same buckets from the demo fixtures
 *     with the pinned demo clock (DEMO_TODAY, TEN-22).
 */
import { describe, expect, it } from 'vitest';

// The IMP-042 service via its explicit selector path (the barrel's wiring).
import { myworkService as svc } from '@/data/mywork/myworkService';
import {
  buildMyWorkBuckets,
  isoWeekEndDate,
  kolkataBusinessDate,
  STANDALONE_RETURNED_NEXT_ACTION,
  type MyWorkItem,
} from '@/data/mywork/types';

/** 2026-09-07 is a Monday; its ISO week ends Sunday 2026-09-13. */
const BUSINESS_DATE = '2026-09-07';

let seq = 0;
function item(partial: Partial<MyWorkItem>): MyWorkItem {
  seq += 1;
  return {
    id: `i-${seq}`,
    kind: 'task',
    title: `item ${seq}`,
    clientId: 'c-1',
    clientName: 'Client',
    dueDate: null,
    priority: 'normal',
    status: 'open',
    nextAction: 'do the thing',
    returned: false,
    waitingReason: null,
    taskId: `i-${seq}`,
    reviewItemId: null,
    ...partial,
  };
}

describe('DEC-L — Asia/Kolkata business date', () => {
  it('derives the business date in Asia/Kolkata regardless of host timezone', () => {
    // 2026-09-06T18:29:59Z = 23:59:59 IST on 09-06 → still the 6th.
    expect(kolkataBusinessDate(new Date('2026-09-06T18:29:59.000Z'))).toBe('2026-09-06');
    // 2026-09-06T18:30:00Z = 00:00:00 IST on 09-07 → the 7th (a UTC-evening
    // instant is already the next business day in India).
    expect(kolkataBusinessDate(new Date('2026-09-06T18:30:00.000Z'))).toBe('2026-09-07');
    // A UTC-morning instant agrees with the UTC date.
    expect(kolkataBusinessDate(new Date('2026-09-06T10:00:00.000Z'))).toBe('2026-09-06');
  });

  it('computes the end of the current ISO week (Sunday, inclusive)', () => {
    expect(isoWeekEndDate('2026-09-07')).toBe('2026-09-13'); // Monday
    expect(isoWeekEndDate('2026-09-12')).toBe('2026-09-13'); // Saturday
    expect(isoWeekEndDate('2026-09-13')).toBe('2026-09-13'); // Sunday ends its own week
    expect(isoWeekEndDate('2026-09-14')).toBe('2026-09-20'); // next Monday
    expect(isoWeekEndDate('2026-12-31')).toBe('2027-01-03'); // year boundary
  });
});

describe('DEC-L — bucket windows and NULL exclusion', () => {
  it('Today is due <= business date, overdue-inclusive; boundary inclusive', () => {
    const overdue = item({ dueDate: '2026-01-15' });
    const dueToday = item({ dueDate: BUSINESS_DATE });
    const buckets = buildMyWorkBuckets([overdue, dueToday], BUSINESS_DATE);
    expect(buckets.today.map((i) => i.dueDate)).toEqual(['2026-01-15', BUSINESS_DATE]);
    expect(buckets.thisWeek).toEqual([]);
  });

  it('This Week is (business date, ISO week end], both bounds exact', () => {
    const tomorrow = item({ dueDate: '2026-09-08' });
    const weekEnd = item({ dueDate: '2026-09-13' }); // Sunday — included
    const beyond = item({ dueDate: '2026-09-14' }); // next Monday — excluded
    const buckets = buildMyWorkBuckets([tomorrow, weekEnd, beyond], BUSINESS_DATE);
    expect(buckets.today).toEqual([]);
    expect(buckets.thisWeek.map((i) => i.dueDate)).toEqual(['2026-09-08', '2026-09-13']);
    // Beyond the ISO week end is not surfaced in ANY bucket.
    expect(buckets.thisWeek).toHaveLength(2);
  });

  it('due_date NULL is excluded from the date buckets but still lands in Waiting/Returned', () => {
    const noDate = item({ dueDate: null });
    const waitingNoDate = item({ dueDate: null, status: 'waiting', waitingReason: 'client docs' });
    const returnedNoDate = item({
      dueDate: null,
      kind: 'returned_review',
      returned: true,
      status: 'returned',
      nextAction: STANDALONE_RETURNED_NEXT_ACTION,
    });
    const buckets = buildMyWorkBuckets([noDate, waitingNoDate, returnedNoDate], BUSINESS_DATE);
    expect(buckets.today).toEqual([]);
    expect(buckets.thisWeek).toEqual([]);
    expect(buckets.waiting.map((i) => i.id)).toEqual([waitingNoDate.id]);
    expect(buckets.returned.map((i) => i.id)).toEqual([returnedNoDate.id]);
  });
});

describe('DEC-L — single-bucket precedence (Returned → Waiting → Today → This Week)', () => {
  it('an item matching multiple buckets appears in exactly one', () => {
    // Overdue + waiting + returned → Returned only.
    const claimed = item({ dueDate: '2026-01-01', status: 'waiting', returned: true });
    // Overdue + waiting → Waiting only.
    const waiting = item({ dueDate: '2026-01-01', status: 'waiting' });
    // In-week + returned → Returned only.
    const returnedInWeek = item({ dueDate: '2026-09-10', returned: true });
    const buckets = buildMyWorkBuckets([claimed, waiting, returnedInWeek], BUSINESS_DATE);
    expect(buckets.returned.map((i) => i.id).sort()).toEqual(
      [claimed.id, returnedInWeek.id].sort(),
    );
    expect(buckets.waiting.map((i) => i.id)).toEqual([waiting.id]);
    expect(buckets.today).toEqual([]);
    expect(buckets.thisWeek).toEqual([]);
    // Total membership: each item in exactly one bucket.
    const total =
      buckets.today.length + buckets.thisWeek.length + buckets.waiting.length + buckets.returned.length;
    expect(total).toBe(3);
  });
});

describe('DEC-L — sort order', () => {
  it('due_date ASC NULLS LAST, then priority highest-first, then stable ID tie-break', () => {
    const a = item({ id: 'b-2', dueDate: '2026-09-01', priority: 'low' });
    const b = item({ id: 'a-1', dueDate: '2026-09-01', priority: 'high' });
    const c = item({ id: 'a-0', dueDate: '2026-09-01', priority: 'high' });
    const e = item({ id: 'c-3', dueDate: '2026-08-20', priority: 'low' }); // earliest date first
    const buckets = buildMyWorkBuckets([a, b, c, e], BUSINESS_DATE);
    expect(buckets.today.map((i) => i.id)).toEqual(['c-3', 'a-0', 'a-1', 'b-2']);
  });

  it('NULLS LAST applies within buckets that can hold NULL-due items (Waiting)', () => {
    // A waiting task keeps its due date if it has one; NULL-due waiting
    // items sort after dated ones even with a higher priority.
    const dated = item({ id: 'w-2', dueDate: '2026-09-01', status: 'waiting', priority: 'low' });
    const undated = item({ id: 'w-1', dueDate: null, status: 'waiting', priority: 'high' });
    const buckets = buildMyWorkBuckets([undated, dated], BUSINESS_DATE);
    expect(buckets.waiting.map((i) => i.id)).toEqual(['w-2', 'w-1']);
  });

  it('unrecognized priority labels rank below the known order without rejection', () => {
    const known = item({ id: 'k-1', dueDate: '2026-09-01', priority: 'normal' });
    const unknown = item({ id: 'u-1', dueDate: '2026-09-01', priority: 'whenever' });
    const buckets = buildMyWorkBuckets([unknown, known], BUSINESS_DATE);
    expect(buckets.today.map((i) => i.id)).toEqual(['k-1', 'u-1']);
  });
});

describe('DEC-L — next_action contract', () => {
  it('the standalone returned ReviewItem action is exactly "Address reviewer feedback"', () => {
    expect(STANDALONE_RETURNED_NEXT_ACTION).toBe('Address reviewer feedback');
    const standalone = item({
      kind: 'returned_review',
      returned: true,
      status: 'returned',
      nextAction: STANDALONE_RETURNED_NEXT_ACTION,
    });
    const buckets = buildMyWorkBuckets([standalone], BUSINESS_DATE);
    expect(buckets.returned[0].nextAction).toBe('Address reviewer feedback');
  });
});

describe('fixture My Work adapter — demo bridge over the demo fixtures', () => {
  it('resolves to fixture mode under the unit harness and is barrel-reachable', async () => {
    expect(svc.mode).toBe('fixture');
    const { myworkService } = await import('@/data');
    expect(myworkService).toBe(svc);
  });

  it('derives the buckets from the demo TASKS with the pinned demo clock (DEMO_TODAY)', async () => {
    const { TASKS, DEMO_TODAY } = await import('@/data/tasks');
    const buckets = await svc.getMyWork();

    // Completed demo tasks are terminal — never surfaced.
    const completedIds = new Set(TASKS.filter((t) => t.category === 'completed').map((t) => t.id));
    const all = [...buckets.today, ...buckets.thisWeek, ...buckets.waiting, ...buckets.returned];
    expect(all.some((i) => completedIds.has(i.id))).toBe(false);

    // The demo 'waiting' category lands in the Waiting bucket with a blocker
    // record (DM-SM-05 parity), regardless of due date.
    const demoWaiting = TASKS.filter((t) => t.category === 'waiting').length;
    expect(buckets.waiting).toHaveLength(demoWaiting);
    expect(buckets.waiting.every((i) => i.status === 'waiting')).toBe(true);
    expect(buckets.waiting.every((i) => i.waitingReason !== null)).toBe(true);

    // Single-bucket membership: ids are unique across buckets.
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);

    // Date-bucket windows hold against the pinned demo business date.
    const businessDate = kolkataBusinessDate(DEMO_TODAY);
    const weekEnd = isoWeekEndDate(businessDate);
    expect(buckets.today.every((i) => i.dueDate !== null && i.dueDate <= businessDate)).toBe(true);
    expect(
      buckets.thisWeek.every(
        (i) => i.dueDate !== null && i.dueDate > businessDate && i.dueDate <= weekEnd,
      ),
    ).toBe(true);

    // Client references resolve through the demo roster.
    expect(all.every((i) => i.clientName !== null)).toBe(true);

    // The demo review seed has no returned items → empty Returned bucket
    // (the demo store overlay returns live in the React store, not here).
    expect(buckets.returned).toEqual([]);
  });
});
