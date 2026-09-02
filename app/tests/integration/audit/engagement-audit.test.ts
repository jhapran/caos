/**
 * IMP-021 — Layer-A audit coverage for engagements (TEST-AUD-01 extension
 * per spec 08 §20 / AUD-CAT-01: engagements are HIGH audit-sensitive).
 *
 * The engagements table rides the IMP-013 audit foundation: the same
 * audit_trg_row() trigger (mapping extended by the IMP-021 migration), the
 * same transaction, the same trust model. This file proves the extension:
 *
 *   - every ordinary authenticated mutation produces exactly one audit row
 *     with complete old/new JSON;
 *   - actor is ALWAYS auth.uid() of the caller; firm derives from the
 *     mutated ROW — never from headers (forged identity/firm headers are
 *     ignored);
 *   - denied mutations (RLS, guard trigger, FK) produce NO audit row
 *     (atomicity: mutation and audit share one transaction);
 *   - audit reads follow the audit_select_partner_admin policy.
 *
 * Fixture rows: deterministic ids in the 98000000-… range; audit rows are
 * asserted via psql (operator) and removed in teardown (append-only
 * applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '98000000-0000-4000-8000-000000000001',
  managerA: '98000000-0000-4000-8000-000000000002',
  partnerB: '98000000-0000-4000-8000-000000000003',
};

const C = {
  a1: '98000000-0000-4000-8000-000000000101',
  b1: '98000000-0000-4000-8000-000000000111',
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const PARTNER_B = userId('USER_B_PARTNER');

let partnerA: string;
let managerA: string;
let partnerB: string;

interface AuditRow {
  id: string;
  firm_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

function auditRows(where: string): AuditRow[] {
  const out = psql(
    `select coalesce(json_agg(row_to_json(t)), '[]'::json)
     from (select * from public.audit_log where ${where} order by created_at) t`,
  );
  return JSON.parse(out);
}

function cleanFixture() {
  psql(`
    delete from public.engagements where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(async () => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-021 Audit Firm A'),
      ('${FIRM_B}', 'IMP-021 Audit Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'ENG Audit Client A1', '${M.partnerA}', '${M.managerA}'),
      ('${C.b1}', '${FIRM_B}', 'ENG Audit Client B1', '${M.partnerB}', null);
  `);
  // Seeding itself writes system-actor audit rows (firms/memberships/
  // clients); remove them so assertions below see only the rows produced
  // by the mutations under test.
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
  partnerA = (await signIn(userEmail('USER_A_PARTNER'))).token;
  managerA = (await signIn(userEmail('USER_A_MANAGER'))).token;
  partnerB = (await signIn(userEmail('USER_B_PARTNER'))).token;
});

afterAll(() => {
  cleanFixture();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('TEST-AUD-01 — engagements: complete old/new per mutation', () => {
  it('engagement INSERT produces one audited row with actor/firm from reality, not headers', async () => {
    const created = await api(partnerA, 'POST', 'engagements', {
      headers: {
        ...H(FIRM_A),
        // Forged identity/firm context — must be ignored by the audit path.
        'x-actor-id': MANAGER_A,
        'x-actor-type': 'service',
        'x-firm-id': FIRM_B,
        'x-service-name': 'forged-cron',
      },
      body: {
        firm_id: FIRM_A,
        client_id: C.a1,
        responsible_partner_membership_id: M.partnerA,
        service_lines: ['GST', 'TDS'],
      },
    });
    expect(created.status).toBe(201);
    const id = created.body[0].id;

    const rows = auditRows(`object_type = 'engagement' and object_id = '${id}'`);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe('insert');
    expect(row.actor_type).toBe('human');
    expect(row.actor_user_id).toBe(PARTNER_A); // auth.uid(), never the forged header
    expect(row.firm_id).toBe(FIRM_A); // from the row, never the forged header
    expect(row.old_value).toBeNull();
    expect(row.new_value).toMatchObject({
      client_id: C.a1,
      firm_id: FIRM_A,
      status: 'draft',
      letter_status: 'not_started',
      service_lines: ['GST', 'TDS'],
    });
  });

  it('engagement UPDATE captures before and after values in one row', async () => {
    const engagementId = psql(
      `select id from public.engagements where firm_id = '${FIRM_A}' and client_id = '${C.a1}' limit 1`,
    ).trim();
    const updated = await api(partnerA, 'PATCH', `engagements?id=eq.${engagementId}`, {
      headers: H(FIRM_A),
      body: { status: 'proposed', letter_status: 'issued', period_label: 'FY 2025-26' },
    });
    expect(updated.status).toBe(200);

    const rows = auditRows(
      `object_type = 'engagement' and object_id = '${engagementId}' and action = 'update'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].old_value).toMatchObject({ status: 'draft', letter_status: 'not_started' });
    expect(rows[0].new_value).toMatchObject({
      status: 'proposed',
      letter_status: 'issued',
      period_label: 'FY 2025-26',
    });
    expect(rows[0].actor_user_id).toBe(PARTNER_A);
  });

  it('a denied mutation produces NO audit row (atomic fail-closed)', async () => {
    // RLS denial: manager is read-only on engagements (RLS-ENG-01).
    const denied = await api(managerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.a1,
        responsible_partner_membership_id: M.partnerA,
      },
    });
    expect(denied.status).toBe(403);

    // Guard-trigger denial: partner attempts an illegal transition.
    const engagementId = psql(
      `select id from public.engagements where firm_id = '${FIRM_A}' and client_id = '${C.a1}' limit 1`,
    ).trim();
    const before = auditRows(
      `object_type = 'engagement' and object_id = '${engagementId}'`,
    ).length;
    const badTransition = await api(partnerA, 'PATCH', `engagements?id=eq.${engagementId}`, {
      headers: H(FIRM_A),
      body: { status: 'terminated', termination_reason: 'x' }, // proposed -> terminated: illegal
    });
    expect(badTransition.status).toBe(400);

    // FK denial: partner attempts an insert against a firm-B client.
    const badFk = await api(partnerA, 'POST', 'engagements', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: C.b1,
        responsible_partner_membership_id: M.partnerA,
      },
    });
    // FK denial: partner attempts an insert against a firm-B client. RLS
    // pins the row shape (403), the FK fires (409), or the responsibility
    // trigger fires first (409) — whichever layer trips, the mutation fails
    // and no audit row is written.
    expect([400, 403, 409]).toContain(badFk.status);

    const afterRows = auditRows(
      `object_type = 'engagement' and firm_id = '${FIRM_A}'`,
    );
    // Only the two legitimate mutations from the earlier tests exist (the
    // insert and the update of the same engagement row); every denied
    // mutation above left zero audit rows.
    expect(afterRows.length).toBe(before);
    expect(
      auditRows(`object_type = 'engagement' and new_value ->> 'status' = 'terminated'`),
    ).toEqual([]);
  });
});

describe('RLS-AUD-01 — audit visibility for engagement rows', () => {
  it('partner reads own-firm audit rows; cross-firm leaks nothing', async () => {
    const own = await api(partnerA, 'GET', 'audit_log?select=id,firm_id', { headers: H(FIRM_A) });
    expect(own.status).toBe(200);
    expect(own.body.length).toBeGreaterThan(0);
    expect(own.body.every((r: { firm_id: string }) => r.firm_id === FIRM_A)).toBe(true);

    const foreign = await api(partnerB, 'GET', 'audit_log?select=id', { headers: H(FIRM_B) });
    expect(foreign.body).toEqual([]);
  });

  it('manager has no audit read access (partner/super_admin only)', async () => {
    const res = await api(managerA, 'GET', 'audit_log?select=id', { headers: H(FIRM_A) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
