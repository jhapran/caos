/**
 * IMP-062 — TEST-API-10 + realtime security contract against the REAL local
 * stack (migration 20261002000000_limited_realtime.sql applied).
 *
 * Proves the R1-B authorization model end-to-end on the platform:
 *
 *   A. Catalog posture: exactly TWO realtime.messages policies (the single
 *      permissive membership-scoped SELECT + the deny-all INSERT), RLS
 *      enabled, both broadcast triggers present — the fail-closed default
 *      (zero OTHER permissive policies) is preserved.
 *   B. Same-firm delivery: an authorized member's private-channel join
 *      SUBSCRIBEs and database-trigger broadcasts arrive; the payload is
 *      INVALIDATION-ONLY (exactly {id, kind, firm_id} — a SECURITY
 *      invariant) for both approved surfaces.
 *   C. Cross-firm denial: a nonmember joining another firm's topic gets the
 *      uniform CHANNEL_ERROR and ZERO events while the authorized channel
 *      is unaffected.
 *   D. Forged/malformed topics (trailing space, extra segment, missing
 *      suffix, uppercase suffix, non-uuid, nonexistent firm, nonmember
 *      cross-surface) ALL fail closed with the same denial shape.
 *   E. Anonymous (no-session) private joins are denied.
 *   F. Client publish denial: a forged client-initiated broadcast is NEVER
 *      delivered to a second authorized subscriber while the control
 *      trigger broadcast IS.
 *   G. Membership revocation (H3): token refresh re-authorizes an open
 *      channel away (delivery stops); a FRESH join after revocation is
 *      denied; re-activation re-authorizes a fresh join.
 *   H. Reconnect: broadcasts during a disconnect are NOT replayed
 *      (ephemeral transport); delivery resumes after reconnect (fresh join
 *      re-authorizes). Missed events are absorbed by the contract
 *      (bare invalidation + authoritative refetch + polling fallback).
 *   I. DML coverage pins: review_items/alerts INSERT and UPDATE-of-status
 *      broadcast; UPDATE of a non-status column and DELETE do NOT.
 *
 * First-broadcast-after-tenant-boot can be lost (platform caveat, LOW-3):
 * every delivery test WARMS the channel first and never asserts on the
 * first-ever broadcast.
 *
 * Deterministic fixture ids in the 69000000-… range; this suite owns its
 * own two firms; re-runnable; teardown removes rows child → parent plus
 * the fixture's audit rows and realtime.messages records (scoped to the
 * owned firm topics only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import { api, localEnv, PASSWORD, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FA = '69000000-0000-4000-8000-00000000f00a';
const FB = '69000000-0000-4000-8000-00000000f00b';
const NOWHERE = '69000000-0000-4000-8000-00000000ffff';

const M = {
  adminA: '69000000-0000-4000-8000-000000000001',
  adminB: '69000000-0000-4000-8000-000000000002',
  partnerA: '69000000-0000-4000-8000-000000000003',
};
const C = {
  firmA: '69000000-0000-4000-8000-000000000101',
};

const TOPIC_RQ_A = `firm:${FA}:review_queue`;
const TOPIC_AL_A = `firm:${FA}:alerts`;
const TOPIC_RQ_B = `firm:${FB}:review_queue`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await sleep(250);
  }
  return cond();
}

function makeClient(): SupabaseClient {
  const { API_URL, ANON_KEY } = localEnv();
  return createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(client: SupabaseClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login ${email}: ${error.message}`);
}

interface SubResult {
  channel: RealtimeChannel;
  status: string;
  err: string | null;
}

function subscribePrivate(
  client: SupabaseClient,
  topic: string,
  onEvent: (msg: { payload?: Record<string, unknown> }) => void,
  timeoutMs = 10_000,
): Promise<SubResult> {
  return new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } });
    channel.on('broadcast', { event: 'invalidate' }, (msg) => onEvent(msg));
    const timer = setTimeout(() => resolve({ channel, status: 'TIMED_OUT', err: null }), timeoutMs);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve({ channel, status, err: err?.message ?? (err ? String(err) : null) });
      }
    });
  });
}

async function expectDenied(client: SupabaseClient, topic: string): Promise<string> {
  const sub = await subscribePrivate(client, topic, () => {});
  try {
    expect(sub.status).not.toBe('SUBSCRIBED');
    return `${sub.status}${sub.err ? `: ${sub.err}` : ''}`;
  } finally {
    await client.removeChannel(sub.channel).catch(() => {});
  }
}

// --- Fixture writes (operator rows, mirroring the production writers) --------
// Alert resolve paths set the same transaction marker the Layer-B commands
// and the IMP-051 evaluator use (the SCH-18 guard blocks status writes
// without it). raiseAlert keeps at most ONE non-resolved fixture alert per
// firm — the HRR-06=A structural dedupe index (alerts_nonresolved_dedupe_
// unique) forbids a second non-resolved (firm, null, null, null) row.

function raiseAlert(firm: string, tag: string): void {
  psql(`
    set app.alert_transition_command = '1';
    update public.alerts set status = 'resolved', resolution_type = 'auto', resolved_at = now()
    where firm_id = '${firm}' and status <> 'resolved';
    insert into public.alerts (firm_id, severity, title, detail)
    values ('${firm}', 'info', 'imp062 rt ${tag}', 'realtime authorization suite');
  `);
}

function submitReviewItem(firm: string, client: string, membership: string, tag: string): string {
  // psql prints the RETURNING rows then the command tag — the id is line 1.
  return psql(`
    insert into public.review_items (firm_id, client_id, type, source, title, submitted_by_membership_id)
    values ('${firm}', '${client}', 'gst_reconciliation', 'human', 'imp062 rt ${tag}', '${membership}')
    returning id;
  `).trim().split('\n')[0];
}

/** Warm the tenant/channel: broadcast until one event arrives (the first
 *  broadcast after a tenant boot may be lost — never assert on it). */
async function warmUp(produce: () => void, received: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    produce();
    if (await waitFor(received, 8_000)) return;
  }
  throw new Error('warm-up broadcast never arrived — realtime delivery broken');
}

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FA}', '${FB}');
    delete from public.review_items where firm_id in ('${FA}', '${FB}');
    delete from public.alerts where firm_id in ('${FA}', '${FB}');
    delete from public.clients where firm_id in ('${FA}', '${FB}');
    delete from public.firm_memberships where firm_id in ('${FA}', '${FB}');
    delete from realtime.messages where topic like 'firm:${FA}:%' or topic like 'firm:${FB}:%';
  `);
}

const clients: SupabaseClient[] = [];
function tracked(client: SupabaseClient): SupabaseClient {
  clients.push(client);
  return client;
}

beforeAll(async () => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FA}', 'IMP-062 RT Firm A'),
      ('${FB}', 'IMP-062 RT Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.adminA}', '${FA}', '${userId('USER_A_SUPER_ADMIN')}', 'super_admin', 'active'),
      ('${M.adminB}', '${FB}', '${userId('USER_B_SUPER_ADMIN')}', 'super_admin', 'active'),
      ('${M.partnerA}', '${FA}', '${userId('USER_A_PARTNER')}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.firmA}', '${FA}', 'RT Client A', '${M.adminA}', null, 'active');
  `);
  // Fixture writes are operator rows; remove fixture noise (IMP-040 precedent).
  psql(`delete from public.audit_log where firm_id in ('${FA}', '${FB}')`);
}, 60_000);

afterAll(async () => {
  for (const client of clients.splice(0)) {
    await client.realtime.disconnect();
    await client.auth.signOut().catch(() => {});
  }
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FA}', '${FB}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id)
      and not exists (select 1 from public.alerts a where a.firm_id = firms.id);
  `);
}, 60_000);

describe('TEST-API-10 — realtime tenant isolation + authorization posture', () => {
  it('A. catalog posture: exactly the two pinned policies, RLS enabled, both triggers, definer functions hardened', () => {
    const policies = psql(
      `select string_agg(policyname || '|' || cmd, ',' order by policyname)
       from pg_policies where schemaname = 'realtime' and tablename = 'messages'`,
    ).trim();
    expect(policies).toBe('imp062_rt_messages_insert_deny|INSERT,imp062_rt_messages_select|SELECT');

    const rls = psql(
      `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'realtime' and c.relname = 'messages'`,
    ).trim();
    expect(rls).toBe('t');

    const triggers = psql(
      `select string_agg(tgname, ',' order by tgname) from pg_trigger where tgname like 'imp062_rt_%'`,
    ).trim();
    expect(triggers).toBe('imp062_rt_alerts_broadcast,imp062_rt_review_items_broadcast');

    const fns = psql(
      `select string_agg(proname || '|' || (case when prosecdef then 't' else 'f' end), ',' order by proname)
       from pg_proc where proname like 'imp062_rt_%'`,
    ).trim();
    expect(fns).toBe('imp062_rt_broadcast_alerts|t,imp062_rt_broadcast_review_queue|t');

    // No publication / REPLICA IDENTITY drift (R1-B uses neither).
    const pub = psql(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime'`).trim();
    expect(pub).toBe('0');
  });

  it('B. same-firm delivery on BOTH approved surfaces; payload is invalidation-only {id, kind, firm_id}', async () => {
    const client = tracked(makeClient());
    await login(client, userEmail('USER_A_SUPER_ADMIN'));

    const rqEvents: Record<string, unknown>[] = [];
    const alEvents: Record<string, unknown>[] = [];
    const rq = await subscribePrivate(client, TOPIC_RQ_A, (m) => rqEvents.push(m.payload ?? {}));
    const al = await subscribePrivate(client, TOPIC_AL_A, (m) => alEvents.push(m.payload ?? {}));
    expect(rq.status).toBe('SUBSCRIBED');
    expect(al.status).toBe('SUBSCRIBED');

    await warmUp(
      () => submitReviewItem(FA, C.firmA, M.adminA, 'warmup-rq'),
      () => rqEvents.length >= 1,
    );
    await warmUp(
      () => raiseAlert(FA, 'warmup-al'),
      () => alEvents.length >= 1,
    );

    const rqBase = rqEvents.length;
    const alBase = alEvents.length;
    const itemId = submitReviewItem(FA, C.firmA, M.adminA, 'delivery-rq');
    raiseAlert(FA, 'delivery-al');
    expect(await waitFor(() => rqEvents.length > rqBase, 10_000)).toBe(true);
    expect(await waitFor(() => alEvents.length > alBase, 10_000)).toBe(true);

    // INVALIDATION-ONLY (SECURITY invariant): exactly {id, kind, firm_id}.
    const rqPayload = rqEvents[rqEvents.length - 1];
    expect(Object.keys(rqPayload).sort()).toEqual(['firm_id', 'id', 'kind']);
    expect(rqPayload.kind).toBe('review_queue.invalidate');
    expect(rqPayload.firm_id).toBe(FA);
    expect(rqPayload.id).toBe(itemId);

    const alPayload = alEvents[alEvents.length - 1];
    expect(Object.keys(alPayload).sort()).toEqual(['firm_id', 'id', 'kind']);
    expect(alPayload.kind).toBe('alerts.invalidate');
    expect(alPayload.firm_id).toBe(FA);
  }, 120_000);

  it('C. cross-firm denial: nonmember join is denied, zero events, authorized channel unaffected', async () => {
    const memberA = tracked(makeClient());
    await login(memberA, userEmail('USER_A_SUPER_ADMIN'));
    const nonmember = tracked(makeClient());
    await login(nonmember, userEmail('USER_B_SUPER_ADMIN'));

    const aEvents: unknown[] = [];
    const authSub = await subscribePrivate(memberA, TOPIC_AL_A, () => aEvents.push(1));
    expect(authSub.status).toBe('SUBSCRIBED');
    await warmUp(
      () => raiseAlert(FA, 'warmup-cross'),
      () => aEvents.length >= 1,
    );

    // Firm B user attempts the Firm A private topic → uniform denial.
    const deniedEvents: unknown[] = [];
    const denied = await subscribePrivate(nonmember, TOPIC_AL_A, () => deniedEvents.push(1));
    expect(denied.status).toBe('CHANNEL_ERROR');
    expect(denied.err).toMatch(/Unauthorized/);

    const aBase = aEvents.length;
    raiseAlert(FA, 'cross-firm-probe');
    expect(await waitFor(() => aEvents.length > aBase, 10_000)).toBe(true); // authorized unaffected
    await sleep(2_000);
    expect(deniedEvents).toHaveLength(0); // zero cross-firm signal
  }, 120_000);

  it('D. forged/malformed topics all fail closed with a uniform denial shape', async () => {
    const client = tracked(makeClient());
    await login(client, userEmail('USER_A_SUPER_ADMIN'));
    const variants = [
      `${TOPIC_RQ_A} `, // trailing space
      `${TOPIC_RQ_A}:extra`, // extra segment
      `firm:${FA}`, // missing suffix
      `firm:${FA}:REVIEW_QUEUE`, // uppercase suffix
      'firm:not-a-uuid:review_queue', // non-uuid
      `firm:${NOWHERE}:review_queue`, // valid-but-nonexistent firm
      TOPIC_RQ_B, // valid firm, NO membership (cross-firm)
      `firm:${FB}:alerts`, // cross-surface nonmembership
    ];
    for (const topic of variants) {
      const denial = await expectDenied(client, topic);
      expect(denial).toMatch(/CHANNEL_ERROR|TIMED_OUT/);
    }
  }, 180_000);

  it('E. anonymous private joins are denied', async () => {
    const anon = tracked(makeClient()); // no session at all
    const denial = await expectDenied(anon, TOPIC_RQ_A);
    expect(denial).toMatch(/CHANNEL_ERROR|TIMED_OUT/);
  }, 60_000);

  it('F. client publish denial: a forged client broadcast is never delivered; the trigger broadcast is', async () => {
    const publisher = tracked(makeClient());
    await login(publisher, userEmail('USER_A_SUPER_ADMIN'));
    const listener = tracked(makeClient());
    await login(listener, userEmail('USER_A_SUPER_ADMIN'));

    const received: unknown[] = [];
    const pub = await subscribePrivate(publisher, TOPIC_AL_A, () => {});
    const lis = await subscribePrivate(listener, TOPIC_AL_A, () => received.push(1));
    expect(pub.status).toBe('SUBSCRIBED');
    expect(lis.status).toBe('SUBSCRIBED');
    await warmUp(
      () => raiseAlert(FA, 'warmup-publish'),
      () => received.length >= 1,
    );

    const base = received.length;
    await pub.channel.send({
      type: 'broadcast',
      event: 'invalidate',
      payload: { id: 'forged', kind: 'alerts.invalidate', firm_id: FA },
    });
    await sleep(3_000);
    expect(received.length).toBe(base); // forged client publish NOT delivered

    raiseAlert(FA, 'publish-control');
    expect(await waitFor(() => received.length > base, 10_000)).toBe(true); // control delivered
  }, 120_000);

  it('G. revocation (H3): refresh re-authorizes an open channel; fresh join after revocation denied; re-activation re-authorizes', async () => {
    const client = tracked(makeClient());
    await login(client, userEmail('USER_A_SUPER_ADMIN'));

    const events: unknown[] = [];
    const sub = await subscribePrivate(client, TOPIC_AL_A, () => events.push(1));
    expect(sub.status).toBe('SUBSCRIBED');
    await warmUp(
      () => raiseAlert(FA, 'warmup-revoke'),
      () => events.length >= 1,
    );

    // Suspend the membership. Join-time authorization means the open
    // channel may still receive until the refresh boundary (accepted H3
    // residual, invalidation-only) — not asserted either way.
    psql(`update public.firm_memberships set status = 'suspended' where id = '${M.adminA}'`);
    try {
      const { error } = await client.auth.refreshSession();
      expect(error).toBeNull();
      await sleep(3_000); // let the refreshed token re-authorize the socket
      const afterRefresh = events.length;
      raiseAlert(FA, 'post-refresh-revoked');
      await sleep(3_000);
      // The H3 backstop: after refresh, delivery to the revoked firm STOPS.
      expect(events.length).toBe(afterRefresh);

      // A FRESH join after revocation is denied outright.
      const fresh = tracked(makeClient());
      await login(fresh, userEmail('USER_A_SUPER_ADMIN'));
      const denial = await expectDenied(fresh, TOPIC_AL_A);
      expect(denial).toMatch(/CHANNEL_ERROR|TIMED_OUT/);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.adminA}'`);
    }

    // Re-activation: a fresh join re-authorizes (fresh-join reevaluation).
    const rejoined = tracked(makeClient());
    await login(rejoined, userEmail('USER_A_SUPER_ADMIN'));
    const ok = await subscribePrivate(rejoined, TOPIC_AL_A, () => {});
    expect(ok.status).toBe('SUBSCRIBED');
  }, 180_000);

  it('H. reconnect: a disconnect-window broadcast is NOT replayed; delivery resumes after rejoin', async () => {
    const client = tracked(makeClient());
    await login(client, userEmail('USER_A_SUPER_ADMIN'));

    const events: unknown[] = [];
    const sub = await subscribePrivate(client, TOPIC_AL_A, () => events.push(1));
    expect(sub.status).toBe('SUBSCRIBED');
    await warmUp(
      () => raiseAlert(FA, 'warmup-reconnect'),
      () => events.length >= 1,
    );

    const before = events.length;
    await client.realtime.disconnect();
    await sleep(1_000);
    raiseAlert(FA, 'during-disconnect');
    await sleep(2_000);
    await client.realtime.connect();
    // The disconnect-window broadcast is ephemeral — it must NOT replay.
    await sleep(4_000);
    expect(events.length).toBe(before);

    // Delivery resumes on the re-joined (fresh, re-authorized) channel.
    raiseAlert(FA, 'after-reconnect');
    expect(await waitFor(() => events.length > before, 15_000)).toBe(true);
  }, 120_000);

  it('I. DML coverage pins: INSERT and UPDATE-of-status broadcast; non-status UPDATE and DELETE do not', async () => {
    const client = tracked(makeClient());
    await login(client, userEmail('USER_A_SUPER_ADMIN'));

    const rqEvents: unknown[] = [];
    const alEvents: unknown[] = [];
    const rq = await subscribePrivate(client, TOPIC_RQ_A, () => rqEvents.push(1));
    const al = await subscribePrivate(client, TOPIC_AL_A, () => alEvents.push(1));
    expect(rq.status).toBe('SUBSCRIBED');
    expect(al.status).toBe('SUBSCRIBED');
    await warmUp(
      () => submitReviewItem(FA, C.firmA, M.adminA, 'warmup-dml'),
      () => rqEvents.length >= 1,
    );

    // INSERT fires (review_items).
    const rqBase = rqEvents.length;
    const itemId = submitReviewItem(FA, C.firmA, M.adminA, 'dml-insert');
    expect(await waitFor(() => rqEvents.length > rqBase, 10_000)).toBe(true);

    // UPDATE OF status fires — through the REAL decide_review_item command
    // (the SCH-17 guard closes direct status writes; the decider is a
    // different live membership, RLS-4EY-04).
    const partnerToken = (await signIn(userEmail('USER_A_PARTNER'))).token;
    const rqPreStatus = rqEvents.length;
    const decided = await api(partnerToken, 'POST', 'rpc/decide_review_item', {
      headers: { 'x-active-firm': FA },
      body: {
        p_review_item_id: itemId,
        p_decision: 'approved',
        p_rationale: 'IMP-062 DML coverage: status broadcast proof',
        p_mutation_key: 'imp062-dml-approve-1',
      },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('decided');
    expect(await waitFor(() => rqEvents.length > rqPreStatus, 10_000)).toBe(true);

    // UPDATE of a NON-status column does NOT fire.
    const rqPreNote = rqEvents.length;
    psql(`update public.review_items set note = 'no broadcast for this' where id = '${itemId}'`);
    await sleep(3_000);
    expect(rqEvents.length).toBe(rqPreNote);

    // DELETE does NOT fire (no DELETE coverage by contract).
    psql(`delete from public.review_items where id = '${itemId}'`);
    await sleep(3_000);
    expect(rqEvents.length).toBe(rqPreNote);

    // alerts: UPDATE OF status fires (resolution analog — through the same
    // transition-command marker the Layer-B commands/evaluator use, and
    // carrying the SCH-18 resolution triple per the lifecycle CHECK).
    const alBase = alEvents.length;
    raiseAlert(FA, 'dml-status');
    expect(await waitFor(() => alEvents.length > alBase, 10_000)).toBe(true);
    const alPreStatus = alEvents.length;
    psql(`
      set app.alert_transition_command = '1';
      update public.alerts set status = 'resolved', resolution_type = 'auto', resolved_at = now()
      where firm_id = '${FA}' and status = 'active' and title like 'imp062 rt dml-status%';
    `);
    expect(await waitFor(() => alEvents.length > alPreStatus, 10_000)).toBe(true);

    // alerts: UPDATE of a NON-status column does NOT fire.
    const alPreDetail = alEvents.length;
    psql(`update public.alerts set detail = 'no broadcast' where firm_id = '${FA}'`);
    await sleep(3_000);
    expect(alEvents.length).toBe(alPreDetail);
  }, 180_000);
});
