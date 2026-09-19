/**
 * IMP-060 — Dashboard data layer: pure helpers + fixture-adapter contract
 * (demo track, no network).
 *
 * Pins:
 *   - the zero/empty contract shapes (every DM-SM-05 / DM-SM-04 key present,
 *     zero-filled; OPEN_INSTANCE_STATES is exactly the non-closed states);
 *   - the fixture demo bridge (selected under the unit-env
 *     VITE_DATA_SOURCE=fixture pin): same DashboardAggregates interface, demo
 *     mapping from the legacy fixtures (AGGREGATES categories → DM-SM-05,
 *     deadline-group buckets → DM-SM-04, REVIEW_ITEMS pending, ALERTS
 *     active), mode 'fixture'.
 *
 * The demo mapping is demo presentation only — H1: live Compliance Health is
 * compliance_instances state truth, asserted for the production adapter in
 * dashboard-supabase-adapter.test.ts and tests/integration/dashboard/.
 */
import { describe, expect, it } from 'vitest';

import { ALERTS, REVIEW_ITEMS } from '@/data';
import { getDeadlineGroups, AGGREGATES } from '@/data';
import { dashboardService } from '@/data/dashboard/dashboardService';
import {
  DASHBOARD_INSTANCE_STATES,
  DASHBOARD_TASK_STATES,
  emptyDashboardAggregates,
  OPEN_INSTANCE_STATES,
  zeroInstanceCounts,
  zeroTaskCounts,
} from '@/data/dashboard/types';

describe('dashboard types — pure helpers', () => {
  it('zeroTaskCounts covers exactly the 8 DM-SM-05 states, zero-filled', () => {
    const counts = zeroTaskCounts();
    expect(Object.keys(counts).sort()).toEqual([...DASHBOARD_TASK_STATES].sort());
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });

  it('zeroInstanceCounts covers exactly the 10 DM-SM-04 states, zero-filled', () => {
    const counts = zeroInstanceCounts();
    expect(Object.keys(counts).sort()).toEqual([...DASHBOARD_INSTANCE_STATES].sort());
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
  });

  it('OPEN_INSTANCE_STATES is exactly the non-closed pipeline', () => {
    expect(OPEN_INSTANCE_STATES).toEqual(
      DASHBOARD_INSTANCE_STATES.filter((s) => s !== 'closed'),
    );
    expect(OPEN_INSTANCE_STATES).not.toContain('closed');
  });

  it('emptyDashboardAggregates is the full zero contract', () => {
    expect(emptyDashboardAggregates()).toEqual({
      taskCountsByState: zeroTaskCounts(),
      complianceInstanceCountsByState: zeroInstanceCounts(),
      atRiskDeadlines: 0,
      reviewPending: 0,
      activeAlerts: 0,
    });
  });
});

describe('dashboardService — fixture adapter contract (demo bridge)', () => {
  it('is the fixture implementation under the unit-env pin', () => {
    expect(dashboardService.mode).toBe('fixture');
  });

  it('returns the full aggregate shape with every state key present', async () => {
    const agg = await dashboardService.getDashboardAggregates();
    expect(Object.keys(agg.taskCountsByState).sort()).toEqual(
      [...DASHBOARD_TASK_STATES].sort(),
    );
    expect(Object.keys(agg.complianceInstanceCountsByState).sort()).toEqual(
      [...DASHBOARD_INSTANCE_STATES].sort(),
    );
    for (const v of [
      ...Object.values(agg.taskCountsByState),
      ...Object.values(agg.complianceInstanceCountsByState),
      agg.atRiskDeadlines,
      agg.reviewPending,
      agg.activeAlerts,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('derives demo values from the legacy fixtures (demo mapping)', async () => {
    const agg = await dashboardService.getDashboardAggregates();

    // Task categories → DM-SM-05 demo mapping.
    expect(agg.taskCountsByState.open).toBe(AGGREGATES.notStarted);
    expect(agg.taskCountsByState.in_progress).toBe(AGGREGATES.inProgress);
    expect(agg.taskCountsByState.waiting).toBe(AGGREGATES.waiting);
    expect(agg.taskCountsByState.submitted).toBe(AGGREGATES.underReview);
    expect(agg.taskCountsByState.done).toBe(AGGREGATES.completed);

    // Deadline-group buckets → DM-SM-04 demo mapping + deadline risk.
    const groups = getDeadlineGroups();
    const sum = (pick: (g: (typeof groups)[number]) => number) =>
      groups.reduce((s, g) => s + pick(g), 0);
    expect(agg.complianceInstanceCountsByState.not_started).toBe(sum((g) => g.notStarted));
    expect(agg.complianceInstanceCountsByState.information_requested).toBe(
      sum((g) => g.waiting),
    );
    expect(agg.complianceInstanceCountsByState.preparation).toBe(sum((g) => g.inProgress));
    expect(agg.complianceInstanceCountsByState.internal_review).toBe(
      sum((g) => g.underReview),
    );
    expect(agg.complianceInstanceCountsByState.ready_to_file).toBe(
      sum((g) => g.readyToFile),
    );
    expect(agg.complianceInstanceCountsByState.filed).toBe(sum((g) => g.filed));
    expect(agg.atRiskDeadlines).toBe(sum((g) => g.atRisk));

    // Scalars straight from the demo fixtures.
    expect(agg.reviewPending).toBe(
      REVIEW_ITEMS.filter((r) => r.status === 'pending').length,
    );
    expect(agg.activeAlerts).toBe(ALERTS.filter((a) => a.status === 'active').length);
  });
});
