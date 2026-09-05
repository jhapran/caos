/**
 * IMP-041 PASS C — Review queue: FIXTURE adapter (demo track, MIG-DS-06).
 *
 * A deterministic in-memory mirror of the SCH-17 / API-R0-RVW contract,
 * seeded from the legacy demo fixture (@/data/review REVIEW_ITEMS — the
 * demo labels are mapped onto the frozen R0 type keys at the boundary) and
 * composed on the existing fixture singletons (clients are READ through
 * fixtureClientHierarchy, linked instances through
 * fixtureComplianceInstances, linked-task return composition through
 * fixtureTasks — this file adds no second copy of any of them). This module
 * never touches the network and never constructs the Supabase client.
 *
 * Fixture role model (documented limit): fixture mode has exactly ONE
 * caller persona — the IMP-014 tenancy demo identity
 * (`demo-fixture-membership`, role 'partner', user `demo-fixture-user`),
 * i.e. firm-wide submit + decision authority in the single demo firm. The
 * adapter enforces the contract's BUSINESS semantics — the frozen type
 * vocabulary, mandatory non-empty rationale, pending → terminal only, the
 * RLS-4EY-04 self-decision denial by membership identity (no rank bypass),
 * keyed state-based replay, and the atomic linked-task return via the
 * fixture task machine — but does NOT simulate the RLS-RVW-01 role-scoping
 * matrix (there is no second persona to scope against). Fixture mode is
 * not security enforcement; RLS security is covered by the PASS-B
 * integration tests.
 *
 * Mutations are module-local and ephemeral (page reload resets them).
 * API-RT-04: the subscription below is a LOCAL invalidation listener — no
 * Supabase channel is opened in fixture mode.
 */
import { fixtureClientHierarchy } from '@/data/clientHierarchy/fixture';
import { fixtureComplianceInstances } from '@/data/complianceInstances/fixture';
import { ApiError } from '@/data/errors';
import { REVIEW_ITEMS } from '@/data/review';
import { fixtureTasks } from '@/data/tasks/fixture';

import type {
  DecideReviewItemResult,
  ReviewDecision,
  ReviewItemRecord,
  ReviewItemStatus,
  ReviewItemType,
  ReviewService,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';

/** The single fixture caller persona (IMP-014 tenancy fixture identity). */
const FIXTURE_CALLER = {
  membershipId: 'demo-fixture-membership',
  userId: 'demo-fixture-user',
} as const;

/** Legacy demo label → frozen R0 key (API-OQ-01). */
const LEGACY_TYPE_MAP: Record<string, ReviewItemType> = {
  'GST Reconciliation': 'gst_reconciliation',
  TDS: 'tds_return',
  ITR: 'itr_computation',
  'Financial Statements': 'financial_statements',
  'Audit Workpaper': 'audit_workpaper',
};

const TYPES: readonly ReviewItemType[] = [
  'gst_reconciliation',
  'tds_return',
  'itr_computation',
  'financial_statements',
  'audit_workpaper',
];

const DECISIONS: readonly ReviewDecision[] = ['approved', 'returned', 'escalated', 'dismissed'];

const TERMINAL: readonly ReviewItemStatus[] = ['approved', 'returned', 'escalated', 'dismissed'];

interface FixtureStore {
  items: ReviewItemRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  return {
    items: REVIEW_ITEMS.map((r) => ({
      id: r.id,
      firmId: DEMO_FIRM_ID,
      clientId: r.clientId,
      taskId: null,
      complianceInstanceId: null,
      type: LEGACY_TYPE_MAP[r.type],
      source: 'human',
      title: r.title,
      note: r.note,
      status: 'pending',
      priority: r.priority,
      submittedByMembershipId: r.submittedBy,
      submittedAt: r.submittedAt,
      decidedByMembershipId: null,
      decidedAt: null,
      decisionRationale: null,
      slaDueAt: null,
      createdAt: r.submittedAt,
      updatedAt: null,
    })),
    sequence: 0,
  };
}

function state(): FixtureStore {
  if (!store) store = buildStore();
  return store;
}

function nextId(label: string): string {
  const s = state();
  s.sequence += 1;
  return `fixture-${label}-${s.sequence}`;
}

const now = () => new Date().toISOString();

const copyItem = (r: ReviewItemRecord): ReviewItemRecord => ({ ...r });

// --- Local invalidation listeners (API-RT-04 fixture simulation) ----------------

const listeners = new Set<() => void>();

function notifyQueueChanged(): void {
  for (const cb of [...listeners]) cb();
}

/** Uniform pre-authorization surface (API-ERR-02): unknown and inaccessible
 *  subjects/items are indistinguishable. Fixture mode has no hidden rows,
 *  so this is simply the unknown-id path — kept identical by contract. */
function notFound(label: string): ApiError {
  return new ApiError('not_found', `${label} not found`);
}

export const fixtureReview: ReviewService = {
  mode: 'fixture',

  async listReviewItems(filter) {
    let rows = state().items;
    if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter?.type) rows = rows.filter((r) => r.type === filter.type);
    if (filter?.submittedByMembershipId) {
      rows = rows.filter((r) => r.submittedByMembershipId === filter.submittedByMembershipId);
    }
    // Oldest-submitted first (the queue order; the Supabase adapter's order).
    return [...rows]
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map(copyItem);
  },

  async submitReviewItem(input) {
    // CA400 parity: malformed input is validation, never a lifecycle error.
    if (!TYPES.includes(input.type)) {
      throw new ApiError('validation', `unknown review type '${input.type}' (API-OQ-01 vocabulary)`);
    }
    if (!input.title.trim()) {
      throw new ApiError('validation', 'title is required (SCH-17)');
    }

    // Subject derivation — linked subject wins authoritatively (SCH-17
    // invariants, API-R0-RVW ordering): task → instance → explicit client.
    let clientId: string | null = null;
    let taskId: string | null = null;
    let complianceInstanceId: string | null = null;
    if (input.taskId) {
      const detail = await fixtureTasks.getTaskDetail(input.taskId);
      if (!detail) throw notFound('review subject');
      if (
        input.complianceInstanceId &&
        detail.task.complianceInstanceId !== input.complianceInstanceId
      ) {
        throw new ApiError(
          'validation',
          'the linked task does not belong to the supplied compliance instance (SCH-17 invariant C)',
        );
      }
      taskId = detail.task.id;
      complianceInstanceId = detail.task.complianceInstanceId;
      clientId = detail.task.clientId; // derived — never the caller value
    } else if (input.complianceInstanceId) {
      const instance = await fixtureComplianceInstances.getComplianceInstance(
        input.complianceInstanceId,
      );
      if (!instance) throw notFound('review subject');
      complianceInstanceId = instance.id;
      clientId = instance.clientId; // derived — never the caller value
    } else {
      if (!input.clientId) {
        throw new ApiError(
          'validation',
          'a review item requires a subject: taskId, complianceInstanceId, or clientId (SCH-17)',
        );
      }
      const client = await fixtureClientHierarchy.getClient(input.clientId);
      if (!client) throw notFound('review subject');
      clientId = input.clientId;
    }
    // A caller-supplied clientId is at most a convenience assertion.
    if (input.clientId && input.clientId !== clientId) {
      throw new ApiError(
        'validation',
        'clientId does not match the linked subject (SCH-17 subject binding)',
      );
    }

    const record: ReviewItemRecord = {
      id: nextId('review-item'),
      firmId: DEMO_FIRM_ID,
      clientId: clientId!,
      taskId,
      complianceInstanceId,
      type: input.type,
      // Server-controlled (SCH-17): human source, pending status, caller
      // membership + server timestamp — never caller input.
      source: 'human',
      title: input.title.trim(),
      note: input.note?.trim() || null,
      status: 'pending',
      priority: input.priority ?? 'normal',
      submittedByMembershipId: FIXTURE_CALLER.membershipId,
      submittedAt: now(),
      decidedByMembershipId: null,
      decidedAt: null,
      decisionRationale: null,
      slaDueAt: input.slaDueAt ?? null,
      createdAt: now(),
      updatedAt: null,
    };
    state().items.push(record);
    notifyQueueChanged();
    return copyItem(record);
  },

  async decideReviewItem(itemId, input): Promise<DecideReviewItemResult> {
    const found = state().items.find((r) => r.id === itemId);
    if (!found) throw notFound('review item');

    if (!DECISIONS.includes(input.decision)) {
      throw new ApiError('validation', `unknown decision '${input.decision}' (DM-SM-06 vocabulary)`);
    }

    // Keyed state-based replay (API-MUT-03) precedes lifecycle conflicts.
    if (TERMINAL.includes(found.status)) {
      if (input.mutationKey) {
        return { status: 'already_applied', reason: 'already_decided', item: copyItem(found) };
      }
      throw new ApiError(
        'conflict',
        `review item is already decided (status ${found.status}); no decision from a terminal state (DM-SM-06)`,
      );
    }

    // RLS-4EY-04: decider ≠ submitter, by membership identity, no rank bypass.
    if (found.submittedByMembershipId === FIXTURE_CALLER.membershipId) {
      throw new ApiError(
        'unauthorized',
        'the deciding membership must differ from the submitting membership (RLS-4EY-04, no privileged-rank bypass)',
      );
    }

    // Mandatory rationale for ALL four decisions (CA402 parity → conflict).
    if (!/[^ \t\n\r]/.test(input.rationale)) {
      throw new ApiError(
        'conflict',
        'a non-empty decision rationale is required for every decision (API-R0-RVW)',
      );
    }

    // Linked-task return composition (DM-SM-06): route through the fixture
    // task machine so the task's own legality/four-eyes rules apply with no
    // drift; on any failure the item stays pending (atomicity).
    let task;
    let reviewerComment;
    if (input.decision === 'returned' && found.taskId !== null) {
      const transitioned = await fixtureTasks.transitionTask(found.taskId, {
        targetStatus: 'returned',
        reviewerComment: input.rationale.trim(),
        mutationKey: input.mutationKey,
      });
      task = transitioned.task;
      reviewerComment = transitioned.reviewerComment;
    }

    const fromStatus = found.status;
    found.status = input.decision;
    found.decidedByMembershipId = FIXTURE_CALLER.membershipId;
    found.decidedAt = now();
    found.decisionRationale = input.rationale.trim();
    found.updatedAt = now();
    notifyQueueChanged();

    return {
      status: 'decided',
      fromStatus,
      toStatus: input.decision,
      item: copyItem(found),
      task,
      reviewerComment,
    };
  },

  subscribeReviewQueue(onInvalidate) {
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  },
};
