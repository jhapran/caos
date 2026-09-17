/**
 * IMP-051 (data-adapter slice) — Deadlines: FIXTURE adapter (demo track).
 *
 * Declared demo bridge (the only adapter-path file allowed to import the
 * legacy fixture modules, per tests/unit/import-boundary.test.ts
 * conventions): it derives the API-R0-DLN projections from the demo
 * fixtures so the demo deployment keeps rendering the familiar boards.
 * Fixture mode is demo-only (TEN-20); production behavior is the Supabase
 * adapter. The demo board derives from the fixture task graph exactly like
 * the legacy getDeadlineGroups(); the dependency projection maps the
 * fixture DEPENDENCY_CLIENTS rows.
 *
 * ONE group-ID contract (Correction-3 reconciliation): the legacy demo
 * board keys groups '<complianceId>::<period label>', but the deadlines
 * domain contract — shared with the Supabase adapter and the
 * deadline_board view — is the canonical
 * '<compliance_type_id>::<YYYY-MM-DD>' (makeDeadlineGroupId /
 * parseDeadlineGroupId). This adapter therefore EMITS canonical ids and
 * resolves them back to the legacy key internally for the drill-down; the
 * legacy period-label key never crosses the service boundary.
 */
import { DEPENDENCY_CLIENTS } from '@/data/dependency';
import { getDeadlineClients, getDeadlineGroups } from '@/data/deadlines';
import { daysUntil } from '@/data/tasks';

import { makeDeadlineGroupId, parseDeadlineGroupId } from './types';
import type {
  ClientDependencyRecord,
  DeadlineGroupRecord,
  DeadlineInstanceRecord,
  DeadlinesService,
} from './types';

export const fixtureDeadlines: DeadlinesService = {
  mode: 'fixture',

  async listDeadlineGroups(): Promise<DeadlineGroupRecord[]> {
    return getDeadlineGroups().map((g) => ({
      groupId: makeDeadlineGroupId(g.complianceId, g.dueDate),
      complianceTypeId: g.complianceId,
      complianceName: g.complianceName,
      dueDate: g.dueDate,
      daysLeft: g.daysLeft,
      totalClients: g.totalClients,
      filed: g.filed,
      readyToFile: g.readyToFile,
      inProgress: g.inProgress,
      waiting: g.waiting,
      underReview: g.underReview,
      notStarted: g.notStarted,
      atRisk: g.atRisk,
    }));
  },

  async listDeadlineGroupInstances(groupId: string): Promise<DeadlineInstanceRecord[]> {
    // API-ERR-02 collection semantics: a malformed group id is an empty
    // collection, never a thrown fixture lookup.
    const parsed = parseDeadlineGroupId(groupId);
    if (!parsed) return [];
    // Canonical id -> the legacy fixture group carrying the same
    // (compliance, dueDate) pair; the legacy drill-down is keyed by
    // '<complianceId>::<period label>'.
    const group = getDeadlineGroups().find(
      (g) => g.complianceId === parsed.complianceTypeId && g.dueDate === parsed.dueDate,
    );
    if (!group) return [];
    return getDeadlineClients(group.id).map(({ task, client }) => ({
      id: task.id,
      clientId: client.id,
      clientName: client.name,
      legalEntityId: client.id,
      entityName: client.name,
      complianceTypeId: task.complianceId,
      complianceName: group.complianceName,
      periodLabel: task.period,
      state: task.state,
      dueDate: task.dueDate,
      daysLeft: daysUntil(task.dueDate),
      assigneeMembershipId: task.ownerId,
      assigneeName: null,
      reviewerMembershipId: null,
      reviewerName: null,
    }));
  },

  async listClientDependencies(): Promise<ClientDependencyRecord[]> {
    return DEPENDENCY_CLIENTS.map((d) => ({
      kind: 'task',
      id: `dep-${d.clientId}`,
      clientId: d.clientId,
      clientName: d.clientName,
      label: d.missingDocs[0] ?? 'Client dependency',
      periodLabel: null,
      waitingReason: d.missingDocs.join(', '),
      status: 'waiting',
      waitingSince: d.lastReminderAt ?? null,
      ageDays: d.oldestWaitDays,
      dueDate: null,
      assigneeMembershipId: d.ownerId,
      reviewerMembershipId: null,
    }));
  },
};
