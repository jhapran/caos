/**
 * IMP-041 API-RT-07 FALLBACK — Review Queue cross-session freshness proof
 * through the provider-neutral subscribeReviewQueue contract.
 *
 * Governing decision (human ruling, 2026-09-06): the executable differential
 * proof established that authenticated postgres_changes cannot satisfy the
 * R0 active-firm RLS context (realtime's per-row RLS evaluation provides
 * role + request.jwt.claims only — never request.headers — so
 * req_active_firm() is NULL there). API-RT-07 therefore applies: the
 * API-RT-01 review queue count/list surface falls back to polling with NO
 * contract change. The adapter's Supabase implementation is the polling
 * fallback in src/data/review/supabase.ts.
 *
 * This suite proves the actual behavior end-to-end on the LOCAL stack
 * through the REAL adapter (not service_role, not a reimplementation):
 *   A. Session A (partner, reviewer) "has the queue open" — it holds a
 *      subscribeReviewQueue subscription and reads through
 *      listReviewItems (the authoritative RLS-controlled read);
 *   B. Session B (manager, a different authenticated identity) submits a
 *      ReviewItem via the submit_review_item RPC;
 *   C. Session A becomes current AUTOMATICALLY — poll tick (invalidation)
 *      → normal listReviewItems RLS refetch. No manual reload, no payload
 *      data (polling carries none);
 *   D. reverse direction — the reviewer's decision lands; the queue is
 *      re-read and the item leaves the pending list;
 *   E. unsubscribe stops further polling invalidations (timer cleared);
 *   F. multiple mounted consumers each get independent safe polling.
 *
 * Timing note: the poll interval is the production 15s implementation
 * parameter — waits here allow >2 intervals; nothing speeds production
 * polling for the test.
 *
 * Deterministic fixture ids in the 68000000-… range; this suite owns its
 * own two firms; re-runnable; teardown removes rows child → parent plus
 * the fixture's audit rows (scoped to the owned firm ids only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { REVIEW_QUEUE_POLL_INTERVAL_MS, supabaseReview } from '@/data/review/supabase';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FA = '68000000-0000-4000-8000-00000000f00a';
const FB = '68000000-0000-4000-8000-00000000f00b';
const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '68000000-0000-4000-8000-000000000001',
  managerA: '68000000-0000-4000-8000-000000000002',
  partnerB: '68000000-0000-4000-8000-000000000003',
};
const C = {
  managed: '68000000-0000-4000-8000-000000000101',
  firmB: '68000000-0000-4000-8000-000000000111',
};

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FA}', '${FB}');
    delete from public.review_items where firm_id in ('${FA}', '${FB}');
    delete from public.clients where firm_id in ('${FA}', '${FB}');
    delete from public.firm_memberships where firm_id in ('${FA}', '${FB}');
  `);
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return cond();
}

let managerAToken: string;
let partnerAToken: string;

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-041 Poll Firm A'),
      ('${FB}', 'IMP-041 Poll Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FA}', '${userId('USER_A_PARTNER')}', 'partner', 'active'),
      ('${M.managerA}', '${FA}', '${userId('USER_A_MANAGER')}', 'manager', 'active'),
      ('${M.partnerB}', '${FB}', '${userId('USER_B_PARTNER')}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.managed}', '${FA}', 'RVW Poll Managed', '${M.partnerA}', '${M.managerA}', 'active'),
      ('${C.firmB}',  '${FB}', 'RVW Poll FirmB',   '${M.partnerB}', null,           'active');
  `);
  // Fixture writes are operator rows; remove fixture noise (IMP-040 precedent).
  psql(`delete from public.audit_log where firm_id in ('${FA}', '${FB}')`);

  // Session A signs in through the REAL adapter client — the behavior under
  // test is the production adapter, not raw fetch and not service_role.
  const client = getSupabaseClient();
  const { error } = await client.auth.signInWithPassword({
    email: userEmail('USER_A_PARTNER'),
    password: 'caos-harness-local-only',
  });
  if (error) throw new Error(`adapter sign-in failed: ${error.message}`);
  setActiveFirm(FA);

  // Session B/C tokens for the "other actor" writes (authenticated REST).
  managerAToken = (await signIn(userEmail('USER_A_MANAGER'))).token;
  partnerAToken = (await signIn(userEmail('USER_A_PARTNER'))).token;
}, 60_000);

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FA}', '${FB}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

describe('API-RT-07 fallback — cross-session review queue freshness', () => {
  it('submit and decision by another actor reach an open queue via polling invalidation → RLS refetch', async () => {
    // A. Session A: queue open — TWO mounted consumers (page + navbar
    // badge) hold independent subscriptions.
    let pageTicks = 0;
    let badgeTicks = 0;
    const unsubPage = supabaseReview.subscribeReviewQueue(() => {
      pageTicks += 1;
    });
    const unsubBadge = supabaseReview.subscribeReviewQueue(() => {
      badgeTicks += 1;
    });

    // Authoritative baseline through the RLS-controlled read.
    const baseline = await supabaseReview.listReviewItems({ status: 'pending' });
    expect(baseline).toEqual([]);

    try {
      // B. Session B (manager) submits — portfolio client, ad-hoc subject.
      const submitted = await api(managerAToken, 'POST', 'rpc/submit_review_item', {
        headers: H(FA),
        body: {
          p_client_id: C.managed,
          p_task_id: null,
          p_compliance_instance_id: null,
          p_type: 'itr_computation',
          p_title: 'RVW poll cross-session',
          p_note: null,
          p_priority: 'normal',
          p_sla_due_at: null,
        },
      });
      expect(submitted.status).toBe(200);
      const itemId = submitted.body.item.id as string;

      // C. Without any reload: the poll tick fires for BOTH consumers,
      // then the authoritative RLS refetch shows the pending item.
      expect(await waitFor(() => pageTicks >= 1 && badgeTicks >= 1, REVIEW_QUEUE_POLL_INTERVAL_MS * 2 + 10_000)).toBe(true);
      const afterSubmit = await supabaseReview.listReviewItems({ status: 'pending' });
      expect(afterSubmit.map((r) => r.id)).toEqual([itemId]);
      expect(afterSubmit[0].status).toBe('pending');

      // D. Reverse direction: the reviewer approves; the next poll
      // invalidation makes the pending queue current again (item leaves).
      const ticksBefore = pageTicks;
      const decided = await api(partnerAToken, 'POST', 'rpc/decide_review_item', {
        headers: H(FA),
        body: {
          p_review_item_id: itemId,
          p_decision: 'approved',
          p_rationale: 'API-RT-07 fallback reverse-direction proof',
          p_mutation_key: 'rt07-fallback-approve-1',
        },
      });
      expect(decided.status).toBe(200);
      expect(decided.body.status).toBe('decided');
      expect(await waitFor(() => pageTicks > ticksBefore, REVIEW_QUEUE_POLL_INTERVAL_MS * 2 + 10_000)).toBe(true);
      const afterDecision = await supabaseReview.listReviewItems({ status: 'pending' });
      expect(afterDecision).toEqual([]);
      const decidedRow = await supabaseReview.listReviewItems();
      expect(decidedRow.find((r) => r.id === itemId)?.status).toBe('approved');

      // F. (multi-consumer safety was asserted above: both ticked.)
      expect(badgeTicks).toBeGreaterThanOrEqual(pageTicks - 1);
    } finally {
      // E. Unsubscribe stops further polling invalidations.
      unsubPage();
      unsubBadge();
    }

    const pageTicksAtUnsub = pageTicks;
    const badgeTicksAtUnsub = badgeTicks;
    await new Promise((r) => setTimeout(r, REVIEW_QUEUE_POLL_INTERVAL_MS * 2 + 2_000));
    expect(pageTicks).toBe(pageTicksAtUnsub);
    expect(badgeTicks).toBe(badgeTicksAtUnsub);
  }, 180_000);
});
