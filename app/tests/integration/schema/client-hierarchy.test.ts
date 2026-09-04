/**
 * IMP-020 — Client-hierarchy schema tests (SCH-04…08).
 *
 * Maps to spec 11:
 *   TEST-SCH-02  FK behavior rejects invalid references at the constraint
 *                layer — client-hierarchy portion: the composite same-firm
 *                FKs (SCH-FK-01/02, SCH-RESP-03) make cross-tenant
 *                relational corruption impossible even for the owner role.
 *   TEST-SCH-03  unique constraints hold — registrations
 *                (firm_id, type, value), per spec 06 SCH-07.
 *   TEST-SCH-09  lifecycle/CHECK vocabularies and the trigger-enforced
 *                invariants (DM-04 active-responsibility, DM-05 entity_type
 *                immutability, DM-06 GSTIN state, SCH-08 primary-contact
 *                email, self-loop rejection).
 *
 * Constraint tests run as postgres via docker psql (owner role proves the
 * invariant holds even WITHOUT RLS — RLS is never the integrity boundary).
 * PostgREST/RLS behavior lives in rls/client-hierarchy-rls.test.ts.
 *
 * Re-runnable: fixture rows use deterministic ids in the 92000000-… range
 * and are force-reset on every run; audit rows produced by fixture writes
 * are removed as the operator (append-only applies to application roles).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIRM_A, FIRM_B, psql, userId } from '../helpers.mjs';

const M = {
  partnerA: '92000000-0000-4000-8000-000000000001',
  managerA: '92000000-0000-4000-8000-000000000002',
  suspendedA: '92000000-0000-4000-8000-000000000003',
  partnerB: '92000000-0000-4000-8000-000000000004',
};

const C = {
  a1: '92000000-0000-4000-8000-000000000101',
  b1: '92000000-0000-4000-8000-000000000111',
};
const E = {
  a1: '92000000-0000-4000-8000-000000000201',
  b1: '92000000-0000-4000-8000-000000000211',
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
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
    delete from public.client_relationships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.contacts where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.registrations where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(() => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-020 Schema Firm A'),
      ('${FIRM_B}', 'IMP-020 Schema Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}',   '${FIRM_A}', '${PARTNER_A}',   'partner', 'active'),
      ('${M.managerA}',   '${FIRM_A}', '${MANAGER_A}',   'manager', 'active'),
      ('${M.suspendedA}', '${FIRM_A}', '${SUSPENDED_A}', 'partner', 'suspended'),
      ('${M.partnerB}',   '${FIRM_B}', '${PARTNER_B}',   'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id) values
      ('${C.a1}', '${FIRM_A}', 'Schema Client A1', '${M.partnerA}'),
      ('${C.b1}', '${FIRM_B}', 'Schema Client B1', '${M.partnerB}');

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.a1}', '${FIRM_A}', '${C.a1}', 'private_limited', 'Schema Entity A1'),
      ('${E.b1}', '${FIRM_B}', '${C.b1}', 'llp',             'Schema Entity B1');
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
  it('legal_entities cannot point at a client of another firm', () => {
    const err = sqlError(
      `insert into public.legal_entities (firm_id, client_id, entity_type, legal_name)
       values ('${FIRM_A}', '${C.b1}', 'llp', 'Cross Firm Entity')`,
    );
    expect(err).toMatch(/legal_entities_client_same_firm|foreign key/i);
  });

  it('registrations cannot point at an entity of another firm', () => {
    const err = sqlError(
      `insert into public.registrations (firm_id, legal_entity_id, type, value)
       values ('${FIRM_A}', '${E.b1}', 'PAN', 'AAAAA0000A')`,
    );
    expect(err).toMatch(/registrations_entity_same_firm|foreign key/i);
  });

  it('client_relationships cannot link entities across firms', () => {
    const err = sqlError(
      `insert into public.client_relationships (firm_id, from_entity_id, to_entity_id, relation_type)
       values ('${FIRM_A}', '${E.a1}', '${E.b1}', 'group')`,
    );
    expect(err).toMatch(/client_relationships_to_same_firm|foreign key/i);
  });

  it('contacts cannot point at a client or entity of another firm', () => {
    expect(
      sqlError(
        `insert into public.contacts (firm_id, client_id, name)
         values ('${FIRM_A}', '${C.b1}', 'Cross Firm Contact')`,
      ),
    ).toMatch(/contacts_client_same_firm|foreign key/i);
    expect(
      sqlError(
        `insert into public.contacts (firm_id, client_id, legal_entity_id, name)
         values ('${FIRM_A}', '${C.a1}', '${E.b1}', 'Cross Firm Entity Contact')`,
      ),
    ).toMatch(/contacts_entity_same_firm|foreign key/i);
  });

  it('clients cannot designate an owner/manager membership of another firm', () => {
    // The DM-04 BEFORE trigger fires before the composite FK's constraint
    // trigger, so a foreign-firm membership surfaces as the responsibility
    // error — either way the write is rejected even for the owner role.
    expect(
      sqlError(
        `insert into public.clients (firm_id, name, owner_partner_membership_id)
         values ('${FIRM_A}', 'Cross Owner', '${M.partnerB}')`,
      ),
    ).toMatch(/owner_partner_membership_id must be an ACTIVE membership|clients_owner_same_firm|foreign key/i);
    expect(
      sqlError(
        `insert into public.clients (firm_id, name, owner_partner_membership_id, manager_membership_id)
         values ('${FIRM_A}', 'Cross Manager', '${M.partnerA}', '${M.partnerB}')`,
      ),
    ).toMatch(/manager_membership_id must be an ACTIVE membership|clients_manager_same_firm|foreign key/i);
  });

  it('same-firm references insert cleanly (control)', () => {
    psql(
      `insert into public.legal_entities (firm_id, client_id, entity_type, legal_name)
       values ('${FIRM_A}', '${C.a1}', 'partnership', 'Schema Entity A2')`,
    );
    expect(
      psql(
        `select count(*) from public.legal_entities where firm_id = '${FIRM_A}' and legal_name = 'Schema Entity A2'`,
      ).trim(),
    ).toBe('1');
  });
});

describe('TEST-SCH-03 — uniqueness', () => {
  it('registrations (firm_id, type, value) is unique per firm, not global', () => {
    psql(
      `insert into public.registrations (firm_id, legal_entity_id, type, value)
       values ('${FIRM_A}', '${E.a1}', 'PAN', 'AAAAA1111A'),
              ('${FIRM_B}', '${E.b1}', 'PAN', 'AAAAA1111A')`,
    );
    const err = sqlError(
      `insert into public.registrations (firm_id, legal_entity_id, type, value)
       values ('${FIRM_A}', '${E.a1}', 'PAN', 'AAAAA1111A')`,
    );
    expect(err).toMatch(/registrations_firm_type_value_unique|duplicate key/i);
  });
});

describe('TEST-SCH-09 — CHECK vocabularies and trigger-enforced invariants', () => {
  it('rejects out-of-vocabulary lifecycle/status/type values', () => {
    expect(
      sqlError(
        `insert into public.clients (firm_id, name, owner_partner_membership_id, status)
         values ('${FIRM_A}', 'Bad Status', '${M.partnerA}', 'archived')`,
      ),
    ).toMatch(/clients_status_check/);
    expect(
      sqlError(
        `insert into public.clients (firm_id, name, owner_partner_membership_id, risk_rating)
         values ('${FIRM_A}', 'Bad Risk', '${M.partnerA}', 'severe')`,
      ),
    ).toMatch(/clients_risk_rating_check/);
    expect(
      sqlError(
        `insert into public.legal_entities (firm_id, client_id, entity_type, legal_name)
         values ('${FIRM_A}', '${C.a1}', 'public_limited', 'Bad Type')`,
      ),
    ).toMatch(/legal_entities_entity_type_check/);
    expect(
      sqlError(
        `insert into public.registrations (firm_id, legal_entity_id, type, value)
         values ('${FIRM_A}', '${E.a1}', 'AADHAAR', 'x')`,
      ),
    ).toMatch(/registrations_type_check/);
    expect(
      sqlError(
        `insert into public.client_relationships (firm_id, from_entity_id, to_entity_id, relation_type)
         values ('${FIRM_A}', '${E.a1}', '${E.a1}', 'group')`,
      ),
    ).toMatch(/client_relationships_no_self_loop/);
  });

  it('DM-06: GSTIN registrations require a state', () => {
    expect(
      sqlError(
        `insert into public.registrations (firm_id, legal_entity_id, type, value)
         values ('${FIRM_A}', '${E.a1}', 'GSTIN', '27AAAAA0000A1Z5')`,
      ),
    ).toMatch(/registrations_gstin_state_check/);
  });

  it('SCH-08: a primary contact requires an email', () => {
    expect(
      sqlError(
        `insert into public.contacts (firm_id, client_id, name, is_primary)
         values ('${FIRM_A}', '${C.a1}', 'No Email Primary', true)`,
      ),
    ).toMatch(/contacts_primary_email_check/);
  });

  it('DM-04: owner/manager must be ACTIVE memberships of the same firm', () => {
    // Suspended membership cannot be designated (status check — 23503 via trigger).
    expect(
      sqlError(
        `insert into public.clients (firm_id, name, owner_partner_membership_id)
         values ('${FIRM_A}', 'Suspended Owner', '${M.suspendedA}')`,
      ),
    ).toMatch(/owner_partner_membership_id must be an ACTIVE membership/);
    expect(
      sqlError(
        `insert into public.clients (firm_id, name, owner_partner_membership_id, manager_membership_id)
         values ('${FIRM_A}', 'Suspended Manager', '${M.partnerA}', '${M.suspendedA}')`,
      ),
    ).toMatch(/manager_membership_id must be an ACTIVE membership/);
    // A manager-role membership is acceptable as manager (control).
    psql(
      `insert into public.clients (firm_id, name, owner_partner_membership_id, manager_membership_id)
       values ('${FIRM_A}', 'Active Manager Client', '${M.partnerA}', '${M.managerA}')`,
    );
  });

  it('DM-05 / SCH-05: entity_type is immutable after creation (marked 23514 → conflict)', () => {
    // psql prints message + detail, not the SQLSTATE; the trigger raises
    // errcode 23514 with detail 'IMMUTABLE_FIELD:legal_entities.entity_type'
    // — the deterministic discriminator toApiError uses to classify this ONE
    // check violation as `conflict` (unit-tested) while every other 23514 is
    // `validation`.
    const err = sqlError(
      `update public.legal_entities set entity_type = 'llp' where id = '${E.a1}'`,
    );
    expect(err).toMatch(/entity_type is immutable/);
    expect(err).toMatch(/IMMUTABLE_FIELD:legal_entities\.entity_type/);
    // Unrelated updates still work (control).
    psql(`update public.legal_entities set legal_name = 'Schema Entity A1 Renamed' where id = '${E.a1}'`);
    expect(
      psql(`select legal_name from public.legal_entities where id = '${E.a1}'`).trim(),
    ).toBe('Schema Entity A1 Renamed');
  });

  it('updated_at maintenance triggers fire on every hierarchy table', () => {
    // set_updated_at() overwrites the column unconditionally, so a sentinel
    // value proves the trigger ran (a plain NOT NULL check would not).
    for (const [table, id] of [
      ['clients', C.a1],
      ['legal_entities', E.a1],
    ] as const) {
      psql(`update public.${table} set updated_at = '2000-01-01T00:00:00Z' where id = '${id}'`);
      expect(
        psql(`select updated_at > '2001-01-01'::timestamptz from public.${table} where id = '${id}'`).trim(),
      ).toBe('t');
    }
  });
});

describe('structure — PKs, uniques, indexes', () => {
  it('every hierarchy table has a uuid PK and the spec indexes exist', () => {
    const pks = psql(
      `select string_agg(conrelid::regclass::text, ',' order by conrelid::regclass::text)
       from pg_constraint where connamespace = 'public'::regnamespace and contype = 'p'
         and conrelid::regclass::text in ('clients','legal_entities','registrations','contacts','client_relationships')`,
    ).trim();
    expect(pks).toBe('client_relationships,clients,contacts,legal_entities,registrations');

    const indexes = psql(
      `select string_agg(indexname, ',' order by indexname) from pg_indexes
       where schemaname = 'public' and indexname in (
         'clients_firm_status_idx','clients_firm_name_idx','clients_owner_partner_idx',
         'legal_entities_client_idx','legal_entities_firm_status_idx',
         'client_relationships_from_idx','client_relationships_to_idx',
         'registrations_legal_entity_idx','registrations_firm_value_idx',
         'contacts_client_idx')`,
    ).trim();
    expect(indexes).toBe(
      [
        'client_relationships_from_idx',
        'client_relationships_to_idx',
        'clients_firm_name_idx',
        'clients_firm_status_idx',
        'clients_owner_partner_idx',
        'contacts_client_idx',
        'legal_entities_client_idx',
        'legal_entities_firm_status_idx',
        'registrations_firm_value_idx',
        'registrations_legal_entity_idx',
      ].join(','),
    );
  });

  it('audit triggers exist on all hierarchy tables + engagements + compliance rules (Layer A, AUD-CAT-01)', () => {
    const triggers = psql(
      `select string_agg(tgrelid::regclass::text, ',' order by tgrelid::regclass::text)
       from pg_trigger where not tgisinternal and tgname ~ '_audit_row$'`,
    ).trim();
    expect(triggers).toBe(
      'client_relationships,clients,compliance_rule_versions,compliance_types,contacts,engagements,firm_memberships,firms,legal_entities,profiles,registrations',
    );
  });
});
