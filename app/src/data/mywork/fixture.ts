/**
 * IMP-042 (data-adapter slice) — My Work: FIXTURE adapter (demo track,
 * MIG-DS-06).
 *
 * The demo bridge: derives the four DEC-L buckets from the existing demo
 * fixture modules — the legacy task dataset (@/data/tasks TASKS), the
 * legacy review dataset (@/data/review REVIEW_ITEMS), and the client roster
 * (@/data/clients) — applying the SAME DEC-L semantics through the shared
 * pure buildMyWorkBuckets (./types), with the pinned demo clock
 * (DEMO_TODAY) as the fixture business date (fixture/demo mode ONLY,
 * TEN-22 — the Supabase adapter uses the real current Asia/Kolkata date).
 * This module never touches the network and never constructs the Supabase
 * client.
 *
 * Demo-shape mappings (documented; the production shapes live in SCH-13/17):
 *   - demo task categories map onto DM-SM-05 posture: 'waiting' → the
 *     Waiting bucket state (with its missing-documents blocker as
 *     waitingReason); 'completed' → terminal (excluded); the remaining
 *     categories are non-terminal actionable work for the date buckets.
 *   - demo tasks carry no next_action column (the demo TaskInstance shape
 *     predates DM-13), so the bridge derives a DETERMINISTIC stand-in from
 *     the workflow state and blocker list — demo-only; production reads the
 *     stored tasks.next_action verbatim.
 *   - demo tasks carry no priority column either; the bridge derives one
 *     from the demo riskScore bands (demo-only; DEC-L introduces no new
 *     priority enum — production reads tasks.priority verbatim).
 *   - demo review items carry no task link, so a returned demo ReviewItem
 *     always surfaces STANDALONE with the exact contract next_action
 *     "Address reviewer feedback" (DEC-L). The demo seed has no returned
 *     items; the demo store's React-context overlay returns live in the
 *     demo store, not the data layer (the same overlay separation the demo
 *     alerts track uses).
 *
 * Fixture role model (documented limit): fixture mode has exactly ONE
 * caller persona (the IMP-014 demo identity, partner) — the DEC-L
 * own-assignment scoping is NOT simulated (there is no second persona to
 * scope against); the demo persona sees the demo firm's actionable
 * portfolio. Own-assignment visibility is enforced for real in the
 * Supabase adapter and covered by the PASS-B integration tests.
 */
import { CLIENTS } from '@/data/clients';
import { REVIEW_ITEMS } from '@/data/review';
import { DEMO_TODAY, TASKS } from '@/data/tasks';
import type { TaskInstance, WorkflowState } from '@/data/types';

import {
  buildMyWorkBuckets,
  kolkataBusinessDate,
  STANDALONE_RETURNED_NEXT_ACTION,
  type MyWorkItem,
  type MyWorkService,
} from './types';

const CLIENT_NAMES = new Map(CLIENTS.map((c) => [c.id, c.name]));

/** Demo category → DM-SM-05 posture (demo-only mapping, documented above). */
const STATE_BY_CATEGORY: Record<string, string> = {
  'in-progress': 'in_progress',
  'waiting': 'waiting',
  'under-review': 'submitted',
  'not-started': 'open',
};

/** Deterministic demo stand-in for tasks.next_action (the demo task shape
 *  carries none): derived from the workflow state and the blocker list. */
function demoNextAction(task: TaskInstance): string {
  const byState: Record<WorkflowState, string> = {
    'Not Started': 'Begin preparation',
    'Information Requested': task.missingDocs[0]
      ? `Collect ${task.missingDocs[0].toLowerCase()} from the client`
      : 'Collect the requested information from the client',
    'Information Received': 'Verify the received information and resume preparation',
    'Preparation': 'Continue preparation',
    'Internal Review': 'Complete the internal review',
    'Client Approval': 'Obtain client approval',
    'Ready to File': 'File the return',
    'Filed': 'Track the acknowledgement',
    'Acknowledgement Received': 'Verify the acknowledgement',
    'Closed': 'No action required',
  };
  return byState[task.state];
}

/** Deterministic demo priority from the demo riskScore bands (the demo
 *  task shape carries no priority column). */
function demoPriority(task: TaskInstance): string {
  if (task.riskScore >= 60) return 'high';
  if (task.riskScore >= 30) return 'normal';
  return 'low';
}

export const fixtureMyWork: MyWorkService = {
  mode: 'fixture',

  async getMyWork() {
    const items: MyWorkItem[] = [];

    for (const t of TASKS) {
      if (t.category === 'completed') continue; // terminal — never My Work
      items.push({
        id: t.id,
        kind: 'task',
        title: `${t.period} · ${t.complianceId}`,
        clientId: t.clientId,
        clientName: CLIENT_NAMES.get(t.clientId) ?? null,
        dueDate: t.dueDate,
        priority: demoPriority(t),
        status: STATE_BY_CATEGORY[t.category] ?? 'open',
        nextAction: demoNextAction(t),
        returned: false,
        waitingReason:
          t.category === 'waiting'
            ? t.missingDocs.length > 0
              ? `Awaiting: ${t.missingDocs.join(', ')}`
              : 'Awaiting client information'
            : null,
        taskId: t.id,
        reviewItemId: null,
      });
    }

    // Returned canonicalization (DEC-L): demo review items carry no task
    // link, so a returned demo ReviewItem always surfaces standalone with
    // the exact contract next_action.
    for (const r of REVIEW_ITEMS) {
      if (r.status !== 'returned') continue;
      items.push({
        id: r.id,
        kind: 'returned_review',
        title: r.title,
        clientId: r.clientId,
        clientName: CLIENT_NAMES.get(r.clientId) ?? null,
        dueDate: null,
        priority: r.priority,
        status: 'returned',
        nextAction: STANDALONE_RETURNED_NEXT_ACTION,
        returned: true,
        waitingReason: null,
        taskId: null,
        reviewItemId: r.id,
      });
    }

    // The pinned demo clock is the fixture business date (TEN-22 — demo
    // mode only; production uses the real current Asia/Kolkata date).
    return buildMyWorkBuckets(items, kolkataBusinessDate(DEMO_TODAY));
  },
};
