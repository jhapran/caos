/**
 * IMP-031 — Compliance profiles & instances audit integration tests
 * (AUD-CAT-01 HIGH-sensitivity coverage for SCH-11/12, AUD-FAIL-01 denial
 * evidence, AUD-CTX-05 fail-closed, TEST-AUD-02/03 families).
 *
 * Verifies, through REAL PostgREST requests plus operator psql inspection
 * of public.audit_log:
 *   - Layer-A row audit on both tables (insert/update with old/new
 *     snapshots, actor ALWAYS auth.uid() of the caller, firm from the row);
 *   - the Layer-B approval command writes exactly one authoritative
 *     `compliance_profile.approve` row and the transition command exactly
 *     one `compliance_instance.transition` row — the app.audit_skip_trigger
 *     marker suppresses Layer-A duplicates (no double audit);
 *   - the transition audit row records the mutation key
 *     (new_value._mutation_key) and idempotent replays add NO audit rows;
 *   - privileged-but-denied attempts are recorded as security-significant
 *     denials (approval_denied / transition_denied with actor, firm,
 *     reason); CA400 validation rejections are deliberately un-audited;
 *   - provenance-mutation rejections leave no mutation audit;
 *   - audit-write failure aborts the operation (fail-closed, AUD-CTX-05)
 *     on both command paths via the test-only app.audit_fault hook
 *     (psql-only simulated request contexts — the audit.test.ts precedent).
 *
 * Re-runnable: deterministic ids in the 65000000-… range, force-reset on
 * every run; fixture audit rows removed as the operator in teardown
 * (append-only applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const SYS_ITR = '50000000-0000-4000-8000-000000000005'; // entity scope

const M = {
  partnerA: '65000000-0000-4000-8000-000000000001',
  managerA: '65000000-0000-4000-8000-000000000002',
  seniorA: '65000000-0000-4000-8000-000000000003',
  articleA: '65000000-0000-4000-8000-000000000004',
  billingA: '65000000-0000-4000-8000-000000000005',
};
const C = {
  a1: '65000000-0000-4000-8000-000000000101', // manager = managerA
  a2: '65000000-0000-4000-8000-000000000102', // manager = null (out of portfolio)
};
const E = {
  a1: '65000000-0000-4000-8000-000000000201',
  a2: '65000000-0000-4000-8000-000000000202',
};
const T = {
  plain: '65000000-0000-4000-8000-0000000000c1', // no four-eyes
  four: '65000000-0000-4000-8000-0000000000c2', // four-eyes
};
const P = {
  out: '65000000-0000-4000-8000-000000000401', // out-of-portfolio denial target
  fault: '65000000-0000-4000-8000-000000000402', // fail-closed approval target
};
const I = {
  four: '65000000-0000-4000-8000-000000000501', // staged internal_review, 4-eyes
  fault: '65000000-0000-4000-8000-000000000502', // fail-closed transition target
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const ARTICLE_A = userId('USER_A_ARTICLE');
const BILLING_A = userId('USER_A_BILLING');

let partnerA: string;
let managerA: string;
let billingA: string;

// Server-assigned ids captured from API creates (tests run in file order).
let profileId = '';
let instanceId = '';

interface AuditRow {
  firm_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

function auditRows(objectId: string): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t) order by t.created_at, t.action), '[]'::json)
     from (select * from public.audit_log
           where object_type in ('compliance_profile', 'compliance_instance')
             and object_id = '${objectId}') t`,
  );
  return JSON.parse(out);
}

function cleanFixture() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_instances where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.client_compliance_profiles where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.compliance_rule_versions where compliance_type_id in ('${T.plain}', '${T.four}');
    delete from public.compliance_types where id in ('${T.plain}', '${T.four}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firm_memberships where id in
      ('${M.partnerA}', '${M.managerA}', '${M.seniorA}', '${M.articleA}', '${M.billingA}');
  `);
}

beforeAll(async () => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-031 Audit Firm A'),
      ('${FIRM_B}', 'IMP-031 Audit Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.articleA}', '${FIRM_A}', '${ARTICLE_A}', 'article_executive', 'active'),
      ('${M.billingA}', '${FIRM_A}', '${BILLING_A}', 'billing', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'CIN Audit Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.a2}', '${FIRM_A}', 'CIN Audit Client A2', '${M.partnerA}', null);

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'CIN Audit Entity A1'),
      ('${E.a2}', '${FIRM_A}', '${C.a2}', 'llp',             'CIN Audit Entity A2');

    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, governance_class, four_eyes_required)
    values
      ('${T.plain}', '${FIRM_A}', 'aud31-plain', 'AUD31 Plain', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', 'non_statutory', false),
      ('${T.four}', '${FIRM_A}', 'aud31-four', 'AUD31 Four-Eyes', 'Certificates',
       'custom', '{}', '{"states":["not_started","preparation","internal_review","ready_to_file","closed"]}',
       'entity', 'non_statutory', true);

    insert into public.client_compliance_profiles (id, firm_id, legal_entity_id, compliance_type_id) values
      ('${P.out}',   '${FIRM_A}', '${E.a2}', '${SYS_ITR}'),
      ('${P.fault}', '${FIRM_A}', '${E.a2}', '50000000-0000-4000-8000-000000000008');

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, assignee_membership_id, reviewer_membership_id)
    values
      ('${I.four}',  '${FIRM_A}', '${E.a1}', '${T.four}',  '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', '${M.seniorA}', '${M.articleA}'),
      ('${I.fault}', '${FIRM_A}', '${E.a1}', '${T.plain}', '2026-04-01', '2026-06-30', 'FY26 Q1', '2026-07-31', null, null);

    -- Stage I.four at internal_review (transaction-local command flag inside
    -- a DO block — the IMP-030 staging precedent; never a request path).
    do $$ begin
      perform set_config('app.cin_transition_command', '1', true);
      update public.compliance_instances set state = 'internal_review' where id = '${I.four}';
    end $$;
  `);
  // Seeding itself writes system-actor audit rows; remove them so
  // assertions below see only the rows produced by the mutations under
  // test (engagement-audit precedent).
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);

  for (const [key, set] of [
    ['USER_A_PARTNER', (t: string) => (partnerA = t)],
    ['USER_A_MANAGER', (t: string) => (managerA = t)],
    ['USER_A_BILLING', (t: string) => (billingA = t)],
  ] as Array<[string, (t: string) => void]>) {
    const s = await signIn(userEmail(key));
    if (!s.ok) throw new Error(`sign-in failed for ${key}: ${JSON.stringify(s.raw)}`);
    set(s.token);
  }
});

afterAll(() => {
  cleanFixture();
  psql(`
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

// ---------------------------------------------------------------------------
// TEST-AUD-02 — Layer-A capture on both tables
// ---------------------------------------------------------------------------

describe('TEST-AUD-02 — Layer-A insert/update capture with old/new snapshots', () => {
  it('profile INSERT produces one audited row: human actor, firm from the row, NEW snapshot only', async () => {
    const res = await api(partnerA, 'POST', 'client_compliance_profiles', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, legal_entity_id: E.a1, compliance_type_id: SYS_ITR },
    });
    expect(res.status).toBe(201);
    profileId = res.body[0].id as string;
    const rows = auditRows(profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].object_type).toBe('compliance_profile');
    expect(rows[0].actor_type).toBe('human');
    expect(rows[0].actor_user_id).toBe(PARTNER_A);
    expect(rows[0].firm_id).toBe(FIRM_A);
    expect(rows[0].old_value).toBeNull();
    expect((rows[0].new_value as { status: string }).status).toBe('proposed');
  });

  it('instance INSERT produces one audited row with the trigger-derived client_id in the snapshot', async () => {
    const res = await api(partnerA, 'POST', 'compliance_instances', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: E.a1,
        compliance_type_id: T.plain,
        period_start: '2026-07-01',
        period_end: '2026-09-30',
        period_label: 'FY26 Q2',
        due_date: '2026-10-31',
      },
    });
    expect(res.status).toBe(201);
    instanceId = res.body[0].id as string;
    const rows = auditRows(instanceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('insert');
    expect(rows[0].object_type).toBe('compliance_instance');
    expect(rows[0].actor_user_id).toBe(PARTNER_A);
    expect((rows[0].new_value as { client_id: string }).client_id).toBe(C.a1);
    expect((rows[0].new_value as { state: string }).state).toBe('not_started');
  });

  it('profile UPDATE carries old AND new values (applicability_answers correction)', async () => {
    const res = await api(partnerA, 'PATCH', `client_compliance_profiles?id=eq.${profileId}`, {
      headers: H(FIRM_A),
      body: { applicability_answers: { turnover: 'above-threshold' } },
    });
    expect(res.status).toBe(200);
    const rows = auditRows(profileId);
    expect(rows).toHaveLength(2);
    const upd = rows.find((r) => r.action === 'update');
    expect(upd).toBeDefined();
    expect(upd!.actor_user_id).toBe(PARTNER_A);
    expect(upd!.old_value!.applicability_answers).toBeNull();
    expect((upd!.new_value as { applicability_answers: { turnover: string } }).applicability_answers.turnover)
      .toBe('above-threshold');
  });

  it('instance due_date move by in-portfolio manager is audited (operative date; AUTO-REC-07 evidence pair)', async () => {
    const res = await api(managerA, 'PATCH', `compliance_instances?id=eq.${instanceId}`, {
      headers: H(FIRM_A),
      body: { due_date: '2026-11-15' },
    });
    expect(res.status).toBe(200);
    const rows = auditRows(instanceId);
    expect(rows).toHaveLength(2);
    const upd = rows.find((r) => r.action === 'update');
    expect(upd).toBeDefined();
    expect(upd!.actor_user_id).toBe(MANAGER_A);
    expect((upd!.old_value as { due_date: string }).due_date).toBe('2026-10-31');
    expect((upd!.new_value as { due_date: string }).due_date).toBe('2026-11-15');
  });

  it('a denied mutation (no row visible to the writer) leaves NO audit row', async () => {
    // billing can neither see nor write the instance: the PATCH matches zero
    // rows, so no trigger fires and nothing is audited.
    const res = await api(billingA, 'PATCH', `compliance_instances?id=eq.${instanceId}`, {
      headers: H(FIRM_A),
      body: { priority: 'low' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(auditRows(instanceId)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// TEST-AUD-03 — Layer-B command audit (skip-marker correctness)
// ---------------------------------------------------------------------------

describe('TEST-AUD-03 — approval command: one authoritative row, no trigger duplicate', () => {
  it('approve writes exactly compliance_profile.approve with old/new status + approval stamps', async () => {
    const res = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: profileId },
    });
    expect(res.body.status).toBe('approved');
    const rows = auditRows(profileId);
    // insert + update + approve — the command's UPDATE produced NO Layer-A
    // 'update' duplicate (app.audit_skip_trigger).
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'compliance_profile.approve']);
    const act = rows[2];
    expect(act.actor_type).toBe('human');
    expect(act.actor_user_id).toBe(PARTNER_A);
    expect(act.firm_id).toBe(FIRM_A);
    expect((act.old_value as { status: string }).status).toBe('proposed');
    expect((act.new_value as { status: string }).status).toBe('active');
    expect((act.new_value as { approved_by: string }).approved_by).toBe(PARTNER_A);
    expect((act.new_value as { approved_at: string | null }).approved_at).not.toBeNull();
  });

  it('re-approval denial is audited (AUD-FAIL-01) and adds no mutation row', async () => {
    const res = await api(partnerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: profileId },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('conflict');
    const rows = auditRows(profileId);
    expect(rows.map((r) => r.action)).toEqual([
      'insert', 'update', 'compliance_profile.approve', 'compliance_profile.approval_denied',
    ]);
    const denied = rows[3];
    expect(denied.actor_user_id).toBe(PARTNER_A);
    expect(denied.old_value).toBeNull();
    expect(String((denied.new_value as { reason: string }).reason)).toContain('proposed');
  });
});

describe('TEST-AUD-03 — transition command: authoritative row, mutation key, no duplicates', () => {
  it('transition writes one row with old/new state and the recorded mutation key', async () => {
    const res = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: instanceId, p_to_state: 'preparation', p_mutation_key: 'aud31-mk-1' },
    });
    expect(res.body.status).toBe('transitioned');
    const rows = auditRows(instanceId);
    expect(rows.map((r) => r.action)).toEqual(['insert', 'update', 'compliance_instance.transition']);
    const tr = rows[2];
    expect(tr.actor_user_id).toBe(MANAGER_A);
    expect(tr.firm_id).toBe(FIRM_A);
    expect((tr.old_value as { state: string }).state).toBe('not_started');
    expect((tr.new_value as { state: string }).state).toBe('preparation');
    expect((tr.new_value as { _mutation_key: string })._mutation_key).toBe('aud31-mk-1');
  });

  it('idempotent replay adds NO audit row; a keyless real transition records no _mutation_key', async () => {
    const replay = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: instanceId, p_to_state: 'preparation', p_mutation_key: 'aud31-mk-1' },
    });
    expect(replay.body.status).toBe('already_applied');
    expect(auditRows(instanceId)).toHaveLength(3);

    const next = await api(managerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: instanceId, p_to_state: 'internal_review' },
    });
    expect(next.body.status).toBe('transitioned');
    const rows = auditRows(instanceId);
    expect(rows).toHaveLength(4);
    const tr = rows[3];
    expect(tr.action).toBe('compliance_instance.transition');
    expect((tr.old_value as { state: string }).state).toBe('preparation');
    expect((tr.new_value as { _mutation_key?: string })._mutation_key).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AUD-FAIL-01 — privileged-denied attempts are recorded
// ---------------------------------------------------------------------------

describe('AUD-FAIL-01 — denial evidence', () => {
  it('billing approval denial is audited with actor, firm, and the API-ERR-02 reason; a nonexistent probe is un-audited', async () => {
    // billing has no approval right: a PRE-authorization visibility failure.
    // The caller sees the uniform not_found surface; because the row EXISTS
    // the probe is security-significant and IS recorded server-side.
    const res = await api(billingA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.out },
    });
    expect(res.body).toEqual({
      status: 'denied',
      kind: 'not_found',
      message: 'compliance profile not found',
    });
    const rows = auditRows(P.out);
    const denied = rows.filter((r) => r.action === 'compliance_profile.approval_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].actor_type).toBe('human');
    expect(denied[0].actor_user_id).toBe(BILLING_A);
    expect(denied[0].firm_id).toBe(FIRM_A);
    expect(denied[0].old_value).toBeNull();
    expect((denied[0].new_value as { reason: string }).reason).toBe('profile not visible to caller (API-ERR-02)');
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.out}';`).trim()).toBe('proposed');

    // A truly nonexistent id: identical caller body, NO audit row (no object
    // to bind the event to — IMP-030 precedent).
    const ghost = '65000000-0000-4000-8000-00000000fffe';
    const miss = await api(billingA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: ghost },
    });
    expect(miss.body).toEqual(res.body);
    expect(auditRows(ghost)).toHaveLength(0);
  });

  it('manager out-of-portfolio approval denial is audited against the manager actor (same API-ERR-02 reason)', async () => {
    const res = await api(managerA, 'POST', 'rpc/approve_client_compliance_profile', {
      headers: H(FIRM_A),
      body: { p_profile_id: P.out },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('not_found');
    const denied = auditRows(P.out).filter((r) => r.action === 'compliance_profile.approval_denied');
    expect(denied).toHaveLength(2);
    expect(denied[1].actor_user_id).toBe(MANAGER_A);
    expect((denied[1].new_value as { reason: string }).reason).toBe('profile not visible to caller (API-ERR-02)');
  });

  it('privileged four-eyes bypass attempt is audited (actor partner, from/to states recorded)', async () => {
    const res = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.four, p_to_state: 'ready_to_file' },
    });
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('unauthorized');
    const denied = auditRows(I.four).filter((r) => r.action === 'compliance_instance.transition_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].actor_user_id).toBe(PARTNER_A);
    expect(String((denied[0].new_value as { reason: string }).reason)).toContain('assigned reviewer');
    expect((denied[0].new_value as { from_state: string }).from_state).toBe('internal_review');
    expect((denied[0].new_value as { to_state: string }).to_state).toBe('ready_to_file');
    expect(psql(`select state from public.compliance_instances where id = '${I.four}';`).trim()).toBe('internal_review');
  });

  it('invalid-transition conflict is audited; malformed target (CA400 validation) is deliberately NOT', async () => {
    const conflict = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.fault, p_to_state: 'ready_to_file' },
    });
    expect(conflict.body.status).toBe('denied');
    expect(conflict.body.kind).toBe('conflict');
    let denied = auditRows(I.fault).filter((r) => r.action === 'compliance_instance.transition_denied');
    expect(denied).toHaveLength(1);
    expect(String((denied[0].new_value as { reason: string }).reason)).toContain('invalid state transition');

    const malformed = await api(partnerA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.fault, p_to_state: 'teleported' },
    });
    expect(malformed.body.status).toBe('denied');
    expect(malformed.body.kind).toBe('validation');
    denied = auditRows(I.fault).filter((r) => r.action === 'compliance_instance.transition_denied');
    expect(denied).toHaveLength(1); // unchanged — CA400 is a client error, not a security event
  });

  it('pre-authorization transition denials on EXISTING rows are audited (API-ERR-02 reason); nonexistent-id probes are not', async () => {
    // billing has no transition right at all: the caller gets the not_found
    // surface, but because the row EXISTS the probe is security-significant
    // and is recorded server-side (never reflected in the caller body).
    const before = auditRows(I.fault).length;
    const res = await api(billingA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: I.fault, p_to_state: 'preparation' },
    });
    expect(res.body).toEqual({
      status: 'denied',
      kind: 'not_found',
      message: 'compliance instance not found',
    });
    const rows = auditRows(I.fault);
    expect(rows).toHaveLength(before + 1);
    const denied = rows[rows.length - 1];
    expect(denied.action).toBe('compliance_instance.transition_denied');
    expect(denied.actor_type).toBe('human');
    expect(denied.actor_user_id).toBe(BILLING_A);
    expect(denied.firm_id).toBe(FIRM_A);
    expect(denied.old_value).toBeNull();
    expect((denied.new_value as { reason: string }).reason).toBe('instance not visible to caller (API-ERR-02)');
    expect((denied.new_value as { to_state: string }).to_state).toBe('preparation');
    expect(psql(`select state from public.compliance_instances where id = '${I.fault}';`).trim()).toBe('not_started');

    // A truly nonexistent id has no object to bind the event to: same
    // caller-visible body, but un-audited (IMP-030 precedent).
    const ghost = '65000000-0000-4000-8000-00000000ffff';
    const miss = await api(billingA, 'POST', 'rpc/transition_compliance_instance', {
      headers: H(FIRM_A),
      body: { p_instance_id: ghost, p_to_state: 'preparation' },
    });
    expect(miss.body).toEqual(res.body);
    expect(auditRows(ghost)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Provenance-mutation rejection leaves no mutation audit (AUTO-REC-07)
// ---------------------------------------------------------------------------

describe('provenance and guard rejections produce no mutation audit', () => {
  it('rejected provenance/identity/state PATCHes add no rows to the instance audit trail', async () => {
    const before = auditRows(instanceId).length;
    for (const body of [
      { rule_version_id: null },
      { generation_source: 'import' },
      { generated_at: '2026-09-04T00:00:00Z' },
      { state: 'ready_to_file' },
      { legal_entity_id: E.a2 },
    ]) {
      const res = await api(managerA, 'PATCH', `compliance_instances?id=eq.${instanceId}`, {
        headers: H(FIRM_A),
        body,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(auditRows(instanceId)).toHaveLength(before);
    const intact = psql(
      `select state || '|' || generation_source from public.compliance_instances where id = '${instanceId}';`,
    ).trim();
    expect(intact).toBe('internal_review|manual');
  });
});

// ---------------------------------------------------------------------------
// AUD-CTX-05 — fail-closed: audit-write failure aborts the command
// ---------------------------------------------------------------------------

describe('AUD-CTX-05 — audit fault rolls back the command atomically (psql-only fault hook)', () => {
  /** Run SQL expected to FAIL; returns the psql error text ('' if it passed). */
  function sqlError(sql: string): string {
    try {
      psql(sql);
      return '';
    } catch (e) {
      const err = e as { stderr?: Buffer | string; message?: string };
      return String(err.stderr ?? err.message ?? '');
    }
  }

  it('transition command: fault aborts mutation AND audit together', () => {
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER_A}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
      set local app.audit_fault = 'fail_audit';
      select public.transition_compliance_instance('${I.fault}', 'preparation', null);
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(psql(`select state from public.compliance_instances where id = '${I.fault}';`).trim()).toBe('not_started');
    expect(auditRows(I.fault).filter((r) => r.action === 'compliance_instance.transition')).toHaveLength(0);
  });

  it('approval command: fault aborts mutation AND audit together', () => {
    const err = sqlError(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER_A}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
      set local app.audit_fault = 'fail_audit';
      select public.approve_client_compliance_profile('${P.fault}');
      commit;
    `);
    expect(err).toContain('fault injected');
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.fault}';`).trim()).toBe('proposed');
    expect(auditRows(P.fault)).toHaveLength(0);
  });

  it('positive control: without the fault hook both commands commit mutation + audit together', () => {
    psql(`
      begin;
      set local request.jwt.claims = '{"sub":"${PARTNER_A}","aal":"aal1","role":"authenticated"}';
      set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
      select public.transition_compliance_instance('${I.fault}', 'preparation', null);
      select public.approve_client_compliance_profile('${P.fault}');
      commit;
    `);
    expect(psql(`select state from public.compliance_instances where id = '${I.fault}';`).trim()).toBe('preparation');
    expect(psql(`select status from public.client_compliance_profiles where id = '${P.fault}';`).trim()).toBe('active');
    expect(
      auditRows(I.fault).map((r) => r.action),
    ).toContain('compliance_instance.transition');
    expect(auditRows(P.fault).map((r) => r.action)).toEqual(['compliance_profile.approve']);
  });
});
