/**
 * IMP-070 — TEST-MIG-15 / MIG-SEED-02, SCH-32: statutory pending posture.
 *
 * Proves, against the live local stack:
 *   1. Every seeded (firm_id IS NULL) statutory rule version is status='draft'
 *      AND domain_approval_status='pending' — 13 expected, 0 offenders; ZERO
 *      statutory versions are status='active' globally; the non-statutory
 *      custom version is draft + 'not_required'.
 *   2. The activation path rejects without domain sign-off, honestly at both
 *      denial layers (read activate_compliance_rule_version in migration
 *      20260904000000_compliance_types_rule_versions.sql):
 *        a. A SEEDED SYSTEM statutory draft (firm_id NULL) is denied by the
 *           TEN-08 fail-closed branch FIRST (firm-NULL rows are rejected
 *           before the role/AAL2/approval gates): structured
 *           {status:'denied', kind:'unauthorized'} with the
 *           'system-default rule versions are not activatable' message.
 *        b. The TEST-RLS-CRV-11 proof shape on a SUITE-FIRM-OWNED statutory
 *           draft (operator-seeded pending): the AAL2 partner of the suite
 *           firm is denied with {status:'denied', kind:'conflict'} and a
 *           message referencing domain_approval_status — the strongest honest
 *           proof of "cannot activate without sign-off".
 *      In BOTH cases the version must remain draft+pending afterwards
 *      (psql-verified — no mutation leaks).
 *
 * AAL2 step-up replicates the makeAal2 pattern from
 * tests/integration/rls/compliance-rules-rls.test.ts (enroll TOTP → challenge
 * → verify with the RFC-6238 code → the aal2 token); the factor is deleted in
 * afterAll via the admin API. Denial audit rows (AUD-FAIL-01) are swept:
 * the suite-firm rows via the shared fixture cleanup, the firm-NULL
 * system-row denial by its test-owned action+actor discriminator
 * (compliance_rule_version.activation_denied / human) — NEVER by bare
 * object_id, because the seeded system-actor insert audit row for
 * SYS_ITR_VERSION shares object_type/object_id and must survive cleanup
 * (AUD-INV-01-safe scoping; Harness HIGH-1 regression).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  FIRM_A,
  adminDeleteFactor,
  adminListFactors,
  api,
  authPost,
  psql,
  signIn,
  totpCode,
  userEmail,
  userId,
} from '../helpers.mjs';
import { SUITE_FIRM, SYS_ITR_VERSION, cleanMigrationFixture, seedMigrationFixture } from './fixture-setup.mjs';

// Suite-firm-owned statutory catalogue rows (the CRV-11 proof-shape fixture).
// The 70000000-… range is owned by this folder; cleanMigrationFixture removes
// them (compliance_rule_versions/compliance_types where firm_id = SUITE_FIRM).
const STAT_TYPE = '70000000-0000-4000-8000-0000000000d1';
const STAT_VERSION = '70000000-0000-4000-8000-0000000000d2';

const H = (firm: string) => ({ 'x-active-firm': firm });
const count = (sql: string): string => psql(sql).trim();

const factorIds: Array<{ user: string; factor: string }> = [];
let partnerA2: string;

/** The seeded system-actor insert audit evidence for SYS_ITR_VERSION
 *  (supabase/seed.sql via the Layer-A trigger). Harness HIGH-1: this suite's
 *  cleanup must NEVER remove it. */
const SEEDED_ITR_AUDIT = `
  select count(*) from public.audit_log
   where object_type = 'compliance_rule_version'
     and object_id = '${SYS_ITR_VERSION}'
     and action = 'insert'
     and actor_type = 'system'
     and firm_id is null;`;

/** Baseline of SEEDED_ITR_AUDIT captured in beforeAll; afterAll must restore
 *  it exactly. testOwnedAuditIds holds the exact audit row ids THIS suite
 *  created (the firm-NULL activation_denial), captured for the afterAll
 *  regression proof. */
let seededAuditBaseline = '0';
const testOwnedAuditIds: string[] = [];

/** The makeAal2 pattern (rls/compliance-rules-rls.test.ts precedent). */
async function makeAal2(userKey: string): Promise<string> {
  const session = await signIn(userEmail(userKey));
  if (!session.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(session.raw)}`);
  const enroll = await authPost('factors', { factor_type: 'totp', friendly_name: `imp070-${userKey}` }, session.token);
  if (enroll.status !== 200) throw new Error(`enroll failed: ${JSON.stringify(enroll.body)}`);
  const factorId = enroll.body.id as string;
  factorIds.push({ user: userId(userKey), factor: factorId });
  const challenge = await authPost(`factors/${factorId}/challenge`, {}, session.token);
  const verify = await authPost(
    `factors/${factorId}/verify`,
    { challenge_id: challenge.body.id, code: totpCode(enroll.body.totp.secret) },
    session.token,
  );
  if (verify.status !== 200 || !verify.body.access_token) {
    throw new Error(`verify failed: ${JSON.stringify(verify.body)}`);
  }
  return verify.body.access_token as string;
}

/** The seeded-statutory truth queries (TEST-MIG-15 core predicates). */
const STATUTORY_OFFENDERS = `
  select count(*) from public.compliance_rule_versions v
  join public.compliance_types t on t.id = v.compliance_type_id
  where v.firm_id is null and t.governance_class = 'statutory'
    and (v.status <> 'draft' or v.domain_approval_status <> 'pending');`;

beforeAll(async () => {
  // The suite firm + live partner membership (the firm-owned activation
  // attempt needs a live same-firm AAL2 partner).
  seedMigrationFixture();
  // Operator-seed the suite-firm-owned statutory draft (firm-owned type with
  // a NON-system type_key may legitimately be statutory; the version carries
  // the pending approval gate state).
  psql(`
    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class)
    values
      ('${STAT_TYPE}', '${SUITE_FIRM}', 'mig070-statutory', 'MIG070 Statutory Draft Type', 'Certificates',
       'custom', '{"description":"suite statutory draft"}', '{"states":["not_started","preparation","closed"]}',
       'configurable', null, 'statutory');

    insert into public.compliance_rule_versions
      (id, firm_id, compliance_type_id, version, effective_from, frequency, due_rule,
       status, domain_approval_status)
    values
      ('${STAT_VERSION}', '${SUITE_FIRM}', '${STAT_TYPE}', 1, '2026-04-01', 'custom',
       '{"description":"pending statutory draft"}', 'draft', 'pending');
  `);
  partnerA2 = await makeAal2('USER_A_PARTNER');
  // HIGH-1 regression baseline: the seeded insert audit row count for
  // SYS_ITR_VERSION BEFORE this suite runs; afterAll must restore it exactly.
  seededAuditBaseline = count(SEEDED_ITR_AUDIT);
});

afterAll(async () => {
  try {
    for (const { user, factor } of factorIds) await adminDeleteFactor(user, factor);
    // Sweep any leftover factors for the AAL2 user (the CRV-suite precedent).
    for (const f of await adminListFactors(userId('USER_A_PARTNER'))) {
      await adminDeleteFactor(userId('USER_A_PARTNER'), f.id);
    }
  } finally {
    // The firm-NULL denial audit row from the system-row attempt is outside
    // the firm-scoped fixture sweep. HIGH-1: delete ONLY this test's
    // activation_denied rows (human actor) — never the seeded system-actor
    // insert evidence for the same object (AUD-INV-01-safe scoping).
    psql(`
      delete from public.audit_log
       where object_type = 'compliance_rule_version'
         and object_id = '${SYS_ITR_VERSION}'
         and action = 'compliance_rule_version.activation_denied'
         and actor_type = 'human';
    `);
    cleanMigrationFixture();
    // HIGH-1 regression proof: cleanup removed exactly this suite's own
    // denial row(s), and the seeded insert audit evidence is intact.
    for (const id of testOwnedAuditIds) {
      expect(count(`select count(*) from public.audit_log where id = '${id}';`)).toBe('0');
    }
    expect(count(SEEDED_ITR_AUDIT)).toBe(seededAuditBaseline);
  }
});

describe('TEST-MIG-15 — seeded statutory rule versions remain draft+pending (MIG-SEED-02, SCH-32)', () => {
  it('every seeded (firm NULL) statutory version is draft+pending — 13 expected, 0 offenders', () => {
    expect(count(STATUTORY_OFFENDERS)).toBe('0');
    expect(count(`
      select count(*) from public.compliance_rule_versions v
      join public.compliance_types t on t.id = v.compliance_type_id
      where v.firm_id is null and t.governance_class = 'statutory'
        and v.status = 'draft' and v.domain_approval_status = 'pending';`)).toBe('13');
  });

  it("zero statutory versions are status='active' globally (OPS-OQ-04 stays a production activation blocker)", () => {
    expect(count(`
      select count(*) from public.compliance_rule_versions v
      join public.compliance_types t on t.id = v.compliance_type_id
      where t.governance_class = 'statutory' and v.status = 'active';`)).toBe('0');
  });

  it("the non-statutory custom version is draft + 'not_required'", () => {
    expect(count(`
      select count(*) from public.compliance_rule_versions v
      join public.compliance_types t on t.id = v.compliance_type_id
      where v.firm_id is null and t.governance_class = 'non_statutory'
        and v.status = 'draft' and v.domain_approval_status = 'not_required';`)).toBe('1');
  });
});

describe('TEST-MIG-15 — activation is rejected without domain sign-off', () => {
  it('a SEEDED SYSTEM statutory draft: the TEN-08 fail-closed branch denies first (firm-NULL rows are not activatable by application roles)', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(FIRM_A),
      body: { p_version_id: SYS_ITR_VERSION },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    // CA401 maps to kind 'unauthorized' — the firm_id IS NULL check precedes
    // the role/AAL2/approval gates, so this is NOT the CRV-11 conflict shape.
    expect(res.body.kind).toBe('unauthorized');
    expect(res.body.message).toContain('system-default rule versions are not activatable');
    // … and the version is untouched afterwards.
    expect(
      count(`select count(*) from public.compliance_rule_versions
              where id = '${SYS_ITR_VERSION}' and status = 'draft' and domain_approval_status = 'pending';`),
    ).toBe('1');
    // HIGH-1: the seeded insert audit evidence is still present mid-suite,
    // and the denial attempt itself wrote exactly the test-owned audit
    // row(s) that afterAll is responsible for (AUD-FAIL-01).
    expect(count(SEEDED_ITR_AUDIT)).toBe(seededAuditBaseline);
    const owned = psql(`
      select id from public.audit_log
       where object_type = 'compliance_rule_version'
         and object_id = '${SYS_ITR_VERSION}'
         and action = 'compliance_rule_version.activation_denied'
         and actor_type = 'human';`);
    const ownedIds = owned.split('\n').map((s) => s.trim()).filter(Boolean);
    expect(ownedIds.length).toBeGreaterThan(0);
    testOwnedAuditIds.push(...ownedIds);
  });

  it('a SUITE-FIRM-OWNED statutory draft: the CRV-11 proof shape — domain_approval_status conflict, remains draft+pending', async () => {
    const res = await api(partnerA2, 'POST', 'rpc/activate_compliance_rule_version', {
      headers: H(SUITE_FIRM),
      body: { p_version_id: STAT_VERSION },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('denied');
    expect(res.body.kind).toBe('conflict');
    expect(res.body.message).toContain('domain_approval_status');
    expect(
      count(`select count(*) from public.compliance_rule_versions
              where id = '${STAT_VERSION}' and status = 'draft' and domain_approval_status = 'pending';`),
    ).toBe('1');
  });

  it('no mutation leaked: after ALL attempts every seeded statutory version is STILL draft+pending', () => {
    expect(count(STATUTORY_OFFENDERS)).toBe('0');
    expect(count(`
      select count(*) from public.compliance_rule_versions v
      join public.compliance_types t on t.id = v.compliance_type_id
      where t.governance_class = 'statutory' and v.status = 'active';`)).toBe('0');
  });
});
