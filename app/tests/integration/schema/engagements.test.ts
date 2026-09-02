/**
 * IMP-021 — Engagement schema tests (SCH-09).
 *
 * Maps to spec 11:
 *   TEST-SCH-02  FK behavior rejects invalid references at the constraint
 *                layer — engagement portion: composite same-firm FKs to
 *                clients and firm_memberships (SCH-FK-01/02, SCH-RESP-03)
 *                make cross-tenant relational corruption impossible even
 *                for the owner role.
 *   TEST-SCH-09  lifecycle/CHECK vocabularies and the trigger-enforced
 *                invariants (DM-09 active-responsibility, DM-SM-03 status
 *                transitions, termination-reason requirement).
 *
 * Constraint tests run as postgres via docker psql (owner role proves the
 * invariant holds even WITHOUT RLS — RLS is never the integrity boundary).
 * PostgREST/RLS behavior lives in rls/engagement-rls.test.ts.
 *
 * Re-runnable: fixture rows use deterministic ids in the 96000000-… range
 * and are force-reset on every run; audit rows produced by fixture writes
 * are removed as the operator (append-only applies to application roles).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql, userId } from '../helpers.mjs';

const M = {
  partnerA: '96000000-0000-4000-8000-000000000001',
  suspendedA: '96000000-0000-4000-8000-000000000002',
  partnerB: '96000000-0000-4000-8000-000000000003',
};

const C = {
  a1: '96000000-0000-4000-8000-000000000101',
  b1: '96000000-0000-4000-8000-000000000111',
};

const G = {
  guard: '96000000-0000-4000-8000-000000000201',
};

const PARTNER_A = userId('USER_A_PARTNER');
const SUSPENDED_A = userId('USER_A_SUSPENDED');
const PARTNER_B = userId('USER_B_PARTNER');

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

function cleanFixture() {
  psql(`
    delete from public.engagements where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(() => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-021 Schema Firm A'),
      ('${FIRM_B}', 'IMP-021 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',   '${FIRM_A}', '${PARTNER_A}',   'partner', 'active'),
      ('${M.suspendedA}', '${FIRM_A}', '${SUSPENDED_A}', 'partner', 'suspended'),
      ('${M.partnerB}',   '${FIRM_B}', '${PARTNER_B}',   'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'ENG Schema Client A1', '${M.partnerA}'),
      ('${C.b1}', '${FIRM_B}', 'ENG Schema Client B1', '${M.partnerB}');
  `);
});

afterAll(() => {
  // Child rows first — the firm/membership deletes would otherwise trip
  // the hierarchy FKs.
  cleanFixture();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('TEST-SCH-02 — composite same-firm FKs reject cross-tenant references', () => {
  it('engagements cannot point at a client of another firm', () => {
    const err = sqlError(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id)
       values ('${FIRM_A}', '${C.b1}', '${M.partnerA}')`,
    );
    expect(err).toMatch(/engagements_client_fkey/);
  });

  it('engagements cannot reference a responsible-partner membership of another firm', () => {
    const err = sqlError(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id)
       values ('${FIRM_A}', '${C.a1}', '${M.partnerB}')`,
    );
    // The DM-09 responsibility trigger (BEFORE INSERT) fires before the FK
    // check: the cross-firm membership is not an ACTIVE same-firm
    // membership, so the trigger message surfaces. The composite FK remains
    // as the constraint-layer backstop (catalog-asserted below).
    expect(err).toMatch(/ACTIVE membership of the same firm|engagements_responsible_partner_fkey/);
  });

  it('the (firm_id, id) parent key exists for the future instance association (SCH-FK-01)', () => {
    const uniques = psql(
      `select conname from pg_constraint
       where conrelid = 'public.engagements'::regclass and contype = 'u'`,
    ).trim();
    expect(uniques).toContain('engagements_firm_id_unique');
  });

  it('the composite FKs exist in the catalog (constraint-layer integrity, not RLS)', () => {
    const fks = psql(
      `select conname || ':' || pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.engagements'::regclass and contype = 'f'`,
    ).trim();
    expect(fks).toContain('engagements_client_fkey:FOREIGN KEY (firm_id, client_id) REFERENCES clients(firm_id, id)');
    expect(fks).toContain(
      'engagements_responsible_partner_fkey:FOREIGN KEY (firm_id, responsible_partner_membership_id) REFERENCES firm_memberships(firm_id, id)',
    );
    expect(fks).toContain('engagements_firm_fkey:FOREIGN KEY (firm_id) REFERENCES firms(id)');
  });
});

describe('TEST-SCH-09 — vocabularies and trigger-enforced invariants', () => {
  it('status / letter_status reject values outside the SCH-09 vocabulary', () => {
    expect(
      sqlError(
        `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id, status)
         values ('${FIRM_A}', '${C.a1}', '${M.partnerA}', 'bogus')`,
      ),
    ).toContain('engagements_status_check');
    expect(
      sqlError(
        `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id, letter_status)
         values ('${FIRM_A}', '${C.a1}', '${M.partnerA}', 'bogus')`,
      ),
    ).toContain('engagements_letter_status_check');
  });

  it('terminated requires a termination reason (plain CHECK → validation)', () => {
    const err = sqlError(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id, status)
       values ('${FIRM_A}', '${C.a1}', '${M.partnerA}', 'terminated')`,
    );
    expect(err).toContain('engagements_termination_reason_check');
    // With a reason the row is accepted (control); clean it up.
    psql(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id, status, termination_reason)
       values ('${FIRM_A}', '${C.a1}', '${M.partnerA}', 'terminated', 'Client exited')`,
    );
    psql(`delete from public.engagements where firm_id = '${FIRM_A}' and status = 'terminated'`);
  });

  it('DM-09: the responsible partner must be an ACTIVE same-firm membership', () => {
    const err = sqlError(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id)
       values ('${FIRM_A}', '${C.a1}', '${M.suspendedA}')`,
    );
    expect(err).toMatch(/responsible_partner_membership_id must be an ACTIVE membership/);
    // An unknown membership id is rejected too — by the trigger (not an
    // ACTIVE membership of the firm) or by the composite FK (no such row);
    // either layer is correct, both are catalog-proven above.
    const fkErr = sqlError(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id)
       values ('${FIRM_A}', '${C.a1}', '96000000-0000-4000-8000-000000000099')`,
    );
    expect(fkErr).toMatch(/ACTIVE membership of the same firm|engagements_responsible_partner_fkey/);
  });

  it('DM-SM-03: only the approved status transitions are allowed (marked 23514 → conflict)', () => {
    psql(
      `insert into public.engagements (id, firm_id, client_id, responsible_partner_membership_id, status)
       values ('${G.guard}', '${FIRM_A}', '${C.a1}', '${M.partnerA}', 'draft')
       on conflict (id) do nothing`,
    );
    // draft -> active skips proposed: illegal, with the deterministic marker.
    const skip = sqlError(
      `update public.engagements set status = 'active' where id = '${G.guard}'`,
    );
    expect(skip).toMatch(/invalid engagements.status transition/);
    expect(skip).toMatch(/INVALID_TRANSITION:engagements.status/);
    // The happy path: draft -> proposed -> active -> completed.
    psql(`update public.engagements set status = 'proposed' where id = '${G.guard}'`);
    psql(`update public.engagements set status = 'active' where id = '${G.guard}'`);
    psql(`update public.engagements set status = 'completed' where id = '${G.guard}'`);
    // completed is terminal — even back to draft.
    const back = sqlError(
      `update public.engagements set status = 'draft' where id = '${G.guard}'`,
    );
    expect(back).toMatch(/INVALID_TRANSITION:engagements.status/);
    // Non-status updates on a terminal row are fine (control).
    psql(`update public.engagements set period_label = 'FY 2025-26' where id = '${G.guard}'`);
    expect(
      psql(`select status || ':' || period_label from public.engagements where id = '${G.guard}'`).trim(),
    ).toBe('completed:FY 2025-26');
  });

  it('active -> terminated works with a reason; terminated is terminal', () => {
    psql(
      `insert into public.engagements (firm_id, client_id, responsible_partner_membership_id, status)
       values ('${FIRM_A}', '${C.a1}', '${M.partnerA}', 'active')`,
    );
    const id = psql(
      `select id from public.engagements where firm_id = '${FIRM_A}' and status = 'active' limit 1`,
    ).trim();
    psql(
      `update public.engagements set status = 'terminated', termination_reason = 'Client exited' where id = '${id}'`,
    );
    const err = sqlError(`update public.engagements set status = 'active' where id = '${id}'`);
    expect(err).toMatch(/INVALID_TRANSITION:engagements.status/);
    psql(`delete from public.engagements where id = '${id}'`);
  });

  it('updated_at maintenance trigger fires on update', () => {
    psql(`update public.engagements set updated_at = '2000-01-01T00:00:00Z' where id = '${G.guard}'`);
    const updated = psql(`select updated_at from public.engagements where id = '${G.guard}'`).trim();
    expect(updated.startsWith('2000-01-01')).toBe(false);
  });

  it('indexes exist (SCH-09): (client_id) and (firm_id, status)', () => {
    const indexes = psql(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = 'engagements'`,
    )
      .trim()
      .split('\n')
      .sort();
    expect(indexes).toEqual(
      expect.arrayContaining(['engagements_client_idx', 'engagements_firm_status_idx']),
    );
  });
});
