/**
 * IMP-060 — Dashboard aggregates: FIXTURE adapter (demo track).
 *
 * Declared demo bridge (the only dashboard adapter-path file allowed to
 * import the legacy fixture modules, per the allowlist in
 * tests/unit/import-boundary.test.ts): it derives the API-R0-DASH aggregate
 * shape from the demo fixtures so the demo deployment keeps rendering the
 * familiar Command Centre / Morning Brief numbers through the same contract.
 * Fixture mode is demo-only (TEN-20); production behavior is the Supabase
 * B-count adapter.
 *
 * Demo-fidelity note: the fixture task graph is categorized
 * (TaskCategory), not DM-SM-05-stated, and carries no compliance-instance
 * rows; the bridge maps the demo categories onto the production vocabularies
 * so the interface is identical in both modes. This mapping is demo
 * presentation only — it is NOT the live Compliance Health definition
 * (H1: live Compliance Health is compliance_instances state truth).
 */
import { ALERTS } from '@/data/alerts';
import { getDeadlineGroups } from '@/data/deadlines';
import { REVIEW_ITEMS } from '@/data/review';
import { AGGREGATES } from '@/data/tasks';

import {
  zeroInstanceCounts,
  zeroTaskCounts,
  type DashboardAggregates,
  type DashboardService,
} from './types';

export const fixtureDashboard: DashboardService = {
  mode: 'fixture',

  async getDashboardAggregates(): Promise<DashboardAggregates> {
    const taskCountsByState = zeroTaskCounts();
    // Demo mapping: fixture task categories onto the DM-SM-05 vocabulary.
    taskCountsByState.open = AGGREGATES.notStarted;
    taskCountsByState.in_progress = AGGREGATES.inProgress;
    taskCountsByState.waiting = AGGREGATES.waiting;
    taskCountsByState.submitted = AGGREGATES.underReview;
    taskCountsByState.done = AGGREGATES.completed;

    // Demo mapping: the fixture deadline board carries per-group DM-SM-04-ish
    // bucket counts; sum them onto the instance-state vocabulary.
    const complianceInstanceCountsByState = zeroInstanceCounts();
    let atRiskDeadlines = 0;
    for (const g of getDeadlineGroups()) {
      complianceInstanceCountsByState.not_started += g.notStarted;
      complianceInstanceCountsByState.information_requested += g.waiting;
      complianceInstanceCountsByState.preparation += g.inProgress;
      complianceInstanceCountsByState.internal_review += g.underReview;
      complianceInstanceCountsByState.ready_to_file += g.readyToFile;
      complianceInstanceCountsByState.filed += g.filed;
      atRiskDeadlines += g.atRisk;
    }

    return {
      taskCountsByState,
      complianceInstanceCountsByState,
      atRiskDeadlines,
      reviewPending: REVIEW_ITEMS.filter((r) => r.status === 'pending').length,
      activeAlerts: ALERTS.filter((a) => a.status === 'active').length,
    };
  },
};
