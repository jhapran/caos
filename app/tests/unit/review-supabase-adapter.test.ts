/**
 * IMP-041 PASS C — Supabase review adapter contract test (production path,
 * network mocked).
 *
 * Pins the adapter to the exact granted surface of the IMP-041 PASS-B
 * contract: it mocks the browser client boundary (@/lib/supabaseClient),
 * captures the exact rpc invocations / table reads / realtime channels, and
 * asserts:
 *
 *   - reads are plain RLS-filtered PostgREST on review_items with the fixed
 *     SCH-17 projection, ordered by submitted_at, UX filters as eq() only;
 *   - submit_review_item carries ONLY the business inputs — never firm_id,
 *     submitted_by_membership_id, submitted_at, status, source, ai_output_id
 *     or any decision field (API-R0-RVW server-controlled set);
 *   - decide_review_item carries exactly p_review_item_id / p_decision /
 *     p_rationale / p_mutation_key (spec 07 signature);
 *   - structured denials map onto the API-ERR-01 taxonomy; already_applied
 *     is a DTO, never an error; embedded task/comment rows map onto the
 *     camelCase DTOs;
 *   - NO direct review_items INSERT/UPDATE/DELETE is ever issued;
 *   - subscribeReviewQueue opens ONE firm-scoped postgres_changes channel
 *     whose callback is pure invalidation, and unsubscribes via
 *     removeChannel (API-RT-01/03); without an active firm it is a no-op.
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production contract without a backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';

const REVIEW_ROW = {
  id: 'ri-1',
  firm_id: 'firm-1',
  client_id: 'client-1',
  task_id: null,
  compliance_instance_id: null,
  type: 'gst_reconciliation',
  source: 'human',
  title: 'GSTR-2A reco',
  note: null,
  status: 'pending',
  priority: 'normal',
  submitted_by_membership_id: 'm-senior',
  submitted_at: '2026-09-04T09:00:00.000Z',
  decided_by_membership_id: null,
  decided_at: null,
  decision_rationale: null,
  ai_output_id: null,
  sla_due_at: null,
  created_at: '2026-09-04T09:00:00.000Z',
  updated_at: null,
};

const DECIDED_ROW = {
  ...REVIEW_ROW,
  status: 'approved',
  decided_by_membership_id: 'm-partner',
  decided_at: '2026-09-05T09:00:00.000Z',
  decision_rationale: 'ties out',
  updated_at: '2026-09-05T09:00:00.000Z',
};

const EMBEDDED_TASK_ROW = {
  id: 'task-1',
  firm_id: 'firm-1',
  client_id: 'client-1',
  compliance_instance_id: null,
  title: 't',
  description: null,
  next_action: 'n',
  status: 'returned',
  waiting_reason: null,
  due_date: null,
  priority: 'normal',
  assignee_membership_id: 'm-senior',
  reviewer_membership_id: 'm-partner',
  time_spent_minutes: 0,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-05T09:00:00.000Z',
};

const EMBEDDED_COMMENT_ROW = {
  id: 'cmt-1',
  firm_id: 'firm-1',
  task_id: 'task-1',
  author_id: 'user-partner',
  body: 'fix the mapping',
  retracted: false,
  created_at: '2026-09-05T09:00:00.000Z',
};

interface CapturedTable {
  table: string;
  verb?: 'insert' | 'update' | 'delete';
}
interface CapturedRpc {
  name: string;
  params: Record<string, unknown>;
}
interface CapturedChannel {
  name: string;
  on: { event: string; config: Record<string, unknown> }[];
  subscribed: boolean;
  removed: boolean;
  emit: () => void;
}

const tableCalls: CapturedTable[] = [];
const rpcCalls: CapturedRpc[] = [];
const channels: CapturedChannel[] = [];
const channelEntries = new Map<object, CapturedChannel>();
let rpcResults: Record<string, unknown> = {};
let listRows: unknown[] = [];

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const entry: CapturedTable = { table };
      tableCalls.push(entry);
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => {
          entry.verb = 'insert';
          return builder;
        },
        update: () => {
          entry.verb = 'update';
          return builder;
        },
        delete: () => {
          entry.verb = 'delete';
          return builder;
        },
        eq: () => builder,
        order: () => builder,
        then: (resolve: (v: unknown) => void) => resolve({ data: listRows, error: null }),
      };
      return builder;
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return { data: rpcResults[name] ?? null, error: null };
    },
    channel: (name: string) => {
      let invalidate: (() => void) | null = null;
      const entry: CapturedChannel = {
        name,
        on: [],
        subscribed: false,
        removed: false,
        emit: () => invalidate?.(),
      };
      const channel = {
        on: (event: string, config: Record<string, unknown>, cb: () => void) => {
          entry.on.push({ event, config });
          invalidate = cb;
          return channel;
        },
        subscribe: () => {
          entry.subscribed = true;
          return channel;
        },
      };
      channels.push(entry);
      channelEntries.set(channel, entry);
      return channel;
    },
    removeChannel: (channel: unknown) => {
      const entry = channelEntries.get(channel as object);
      if (entry) entry.removed = true;
      return Promise.resolve('ok');
    },
  }),
}));

import { supabaseReview } from '@/data/review/supabase';

/** Keys no browser caller may ever send on submission (server-controlled). */
const FORBIDDEN_SUBMIT_KEYS = [
  'p_firm_id',
  'p_submitted_by_membership_id',
  'p_submitted_at',
  'p_status',
  'p_source',
  'p_ai_output_id',
  'p_decided_by_membership_id',
  'p_decided_at',
  'p_decision_rationale',
];

describe('supabase review adapter — reads', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    channels.length = 0;
    rpcResults = {};
    listRows = [];
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('lists RLS-filtered rows with the SCH-17 projection, mapped to camelCase DTOs', async () => {
    listRows = [REVIEW_ROW];
    const items = await supabaseReview.listReviewItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'ri-1',
      firmId: 'firm-1',
      clientId: 'client-1',
      type: 'gst_reconciliation',
      status: 'pending',
      submittedByMembershipId: 'm-senior',
      decidedByMembershipId: null,
    });
    expect(items[0]).not.toHaveProperty('firm_id');
    expect(items[0]).not.toHaveProperty('ai_output_id');
    // UX filters narrow through eq() only; an empty result is [] not an error.
    listRows = [];
    expect(await supabaseReview.listReviewItems({ status: 'approved' })).toEqual([]);
    expect(tableCalls.every((c) => c.table === 'review_items')).toBe(true);
    expect(tableCalls.every((c) => c.verb === undefined)).toBe(true);
  });
});

describe('supabase review adapter — submit_review_item', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    rpcResults = {};
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('sends ONLY the business inputs with the exact spec-07 parameter names', async () => {
    rpcResults['submit_review_item'] = { status: 'submitted', item: REVIEW_ROW };
    const item = await supabaseReview.submitReviewItem({
      clientId: 'client-1',
      type: 'gst_reconciliation',
      title: 'GSTR-2A reco',
      note: null,
      priority: 'high',
      slaDueAt: null,
    });
    expect(item.id).toBe('ri-1');
    expect(rpcCalls).toEqual([
      {
        name: 'submit_review_item',
        params: {
          p_client_id: 'client-1',
          p_task_id: null,
          p_compliance_instance_id: null,
          p_type: 'gst_reconciliation',
          p_title: 'GSTR-2A reco',
          p_note: null,
          p_priority: 'high',
          p_sla_due_at: null,
        },
      },
    ]);
    for (const forbidden of FORBIDDEN_SUBMIT_KEYS) {
      expect(Object.keys(rpcCalls[0].params)).not.toContain(forbidden);
    }
    // No direct table write took part.
    expect(tableCalls).toHaveLength(0);
  });

  it('omitted optionals default to null / normal priority', async () => {
    rpcResults['submit_review_item'] = { status: 'submitted', item: REVIEW_ROW };
    await supabaseReview.submitReviewItem({
      taskId: 'task-1',
      type: 'tds_return',
      title: 'x',
    });
    expect(rpcCalls[0].params).toEqual({
      p_client_id: null,
      p_task_id: 'task-1',
      p_compliance_instance_id: null,
      p_type: 'tds_return',
      p_title: 'x',
      p_note: null,
      p_priority: 'normal',
      p_sla_due_at: null,
    });
  });

  it('structured denials map onto the API-ERR-01 taxonomy', async () => {
    rpcResults['submit_review_item'] = {
      status: 'denied',
      kind: 'unauthorized',
      message: 'outside your scope',
    };
    await expect(
      supabaseReview.submitReviewItem({ clientId: 'c', type: 'tds_return', title: 'x' }),
    ).rejects.toMatchObject({ name: 'ApiError', kind: 'unauthorized', message: 'outside your scope' });

    rpcResults['submit_review_item'] = {
      status: 'denied',
      kind: 'validation',
      message: 'clientId does not match the linked subject',
    };
    await expect(
      supabaseReview.submitReviewItem({ clientId: 'c', type: 'tds_return', title: 'x' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('supabase review adapter — decide_review_item', () => {
  beforeEach(() => {
    tableCalls.length = 0;
    rpcCalls.length = 0;
    rpcResults = {};
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('sends the exact spec-07 signature; a decision maps onto the DTO', async () => {
    rpcResults['decide_review_item'] = {
      status: 'decided',
      from_status: 'pending',
      to_status: 'approved',
      item: DECIDED_ROW,
    };
    const result = await supabaseReview.decideReviewItem('ri-1', {
      decision: 'approved',
      rationale: 'ties out',
      mutationKey: 'mk-1',
    });
    expect(result.status).toBe('decided');
    expect(result.item.status).toBe('approved');
    expect(result.item.decidedByMembershipId).toBe('m-partner');
    expect(result.fromStatus).toBe('pending');
    expect(result.toStatus).toBe('approved');
    expect(rpcCalls).toEqual([
      {
        name: 'decide_review_item',
        params: {
          p_review_item_id: 'ri-1',
          p_decision: 'approved',
          p_rationale: 'ties out',
          p_mutation_key: 'mk-1',
        },
      },
    ]);
    expect(tableCalls).toHaveLength(0);
  });

  it('task-linked return maps the embedded task + reviewer comment DTOs', async () => {
    rpcResults['decide_review_item'] = {
      status: 'decided',
      from_status: 'pending',
      to_status: 'returned',
      item: { ...DECIDED_ROW, status: 'returned', task_id: 'task-1' },
      task: EMBEDDED_TASK_ROW,
      reviewer_comment: EMBEDDED_COMMENT_ROW,
    };
    const result = await supabaseReview.decideReviewItem('ri-1', {
      decision: 'returned',
      rationale: 'fix the mapping',
    });
    expect(result.task).toMatchObject({ id: 'task-1', status: 'returned' });
    expect(result.task).not.toHaveProperty('firm_id');
    expect(result.reviewerComment).toMatchObject({ id: 'cmt-1', body: 'fix the mapping' });
    // No key supplied → null, never undefined.
    expect(rpcCalls[0].params.p_mutation_key).toBeNull();
  });

  it('already_applied is a DTO (never an error); denials map to ApiError kinds', async () => {
    rpcResults['decide_review_item'] = {
      status: 'already_applied',
      reason: 'already_decided',
      item: DECIDED_ROW,
    };
    const replay = await supabaseReview.decideReviewItem('ri-1', {
      decision: 'approved',
      rationale: 'again',
      mutationKey: 'mk-1',
    });
    expect(replay.status).toBe('already_applied');
    expect(replay.reason).toBe('already_decided');
    expect(replay.item.status).toBe('approved');

    // Pre-authorization not_found (API-ERR-02 uniform surface).
    rpcResults['decide_review_item'] = {
      status: 'denied',
      kind: 'not_found',
      message: 'review item not found',
    };
    await expect(
      supabaseReview.decideReviewItem('hidden', { decision: 'approved', rationale: 'x' }),
    ).rejects.toMatchObject({ kind: 'not_found' });

    // Four-eyes self-decision denial.
    rpcResults['decide_review_item'] = {
      status: 'denied',
      kind: 'unauthorized',
      message: 'the deciding membership must differ from the submitting membership',
    };
    await expect(
      supabaseReview.decideReviewItem('ri-1', { decision: 'approved', rationale: 'self' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });

    // Blank rationale / terminal re-decision conflicts.
    rpcResults['decide_review_item'] = {
      status: 'denied',
      kind: 'conflict',
      message: 'a non-empty decision rationale is required',
    };
    await expect(
      supabaseReview.decideReviewItem('ri-1', { decision: 'approved', rationale: '  ' }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });
});

describe('supabase review adapter — realtime invalidation (API-RT-01/03)', () => {
  beforeEach(() => {
    channels.length = 0;
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('opens ONE firm-scoped channel; events are pure invalidation; unsubscribe removes it', async () => {
    let invalidated = 0;
    const unsubscribe = supabaseReview.subscribeReviewQueue(() => {
      invalidated += 1;
    });
    expect(channels).toHaveLength(1);
    const ch = channels[0];
    expect(ch.name).toMatch(/^review-queue-firm-1-\d+$/);
    expect(ch.subscribed).toBe(true);
    expect(ch.on).toEqual([
      {
        event: 'postgres_changes',
        config: {
          event: '*',
          schema: 'public',
          table: 'review_items',
          filter: 'firm_id=eq.firm-1',
        },
      },
    ]);
    ch.emit();
    ch.emit();
    expect(invalidated).toBe(2);
    unsubscribe();
    expect(ch.removed).toBe(true);
  });

  it('without an active firm the subscription is a no-op', () => {
    clearActiveFirm();
    const unsubscribe = supabaseReview.subscribeReviewQueue(() => {});
    expect(channels).toHaveLength(0);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('simultaneous subscribers (Navbar + page) get DISTINCT channels; each unsubscribes independently', () => {
    // PASS C.1 §13: Navbar badge and the Review Queue page can be mounted at
    // the same time — duplicate channel names would crash the Supabase
    // realtime client, so each subscription gets its own sequenced name.
    let first = 0;
    let second = 0;
    const unsubFirst = supabaseReview.subscribeReviewQueue(() => {
      first += 1;
    });
    const unsubSecond = supabaseReview.subscribeReviewQueue(() => {
      second += 1;
    });

    expect(channels).toHaveLength(2);
    expect(channels[0].name).not.toBe(channels[1].name);
    expect(channels[0].name).toMatch(/^review-queue-firm-1-\d+$/);
    expect(channels[1].name).toMatch(/^review-queue-firm-1-\d+$/);
    expect(channels.every((c) => c.subscribed)).toBe(true);

    // Each channel invalidates its own subscriber only.
    channels[0].emit();
    expect(first).toBe(1);
    expect(second).toBe(0);

    // Unsubscribing one marks only its own channel removed.
    unsubFirst();
    expect(channels[0].removed).toBe(true);
    expect(channels[1].removed).toBe(false);
    channels[1].emit();
    expect(second).toBe(1);
    unsubSecond();
    expect(channels[1].removed).toBe(true);
  });
});
