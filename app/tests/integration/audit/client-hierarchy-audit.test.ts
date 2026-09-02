/**
 * IMP-020 — Layer-A audit coverage for the client hierarchy (TEST-AUD-01
 * extension per spec 08 §20 / AUD-CAT-01).
 *
 * The five IMP-020 tables are HIGH/MEDIUM audit-sensitive and ride the
 * IMP-013 audit foundation: the same audit_trg_row() trigger, the same
 * transaction, the same trust model. This file proves the extension:
 *
 *   - every ordinary authenticated mutation on the five tables produces
 *     exactly one audit row with complete old/new JSON;
 *   - actor is ALWAYS auth.uid() of the caller; firm derives from the
 *     mutated ROW — never from headers (forged identity/firm headers are
 *     ignored);
 *   - a denied mutation produces NO audit row (atomicity: mutation and
 *     audit share one transaction);
 *   - audit reads follow the audit_select_partner_admin policy: partner
 *     sees own-firm rows, manager does not, cross-firm leaks nothing.
 *
 * Fixture rows: deterministic ids in the 94000000-… range; audit rows are
 * asserted via psql (operator) and removed in teardown (append-only
 * applies to application roles, AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, FIRM_A, FIRM_B, psql, signIn, userEmail, userId } from '../helpers.mjs';

const H = (firm: string) => ({ 'x-active-firm': firm });

const M = {
  partnerA: '94000000-0000-4000-8000-000000000001',
  managerA: '94000000-0000-4000-8000-000000000002',
  seniorA: '94000000-0000-4000-8000-000000000003',
  partnerB: '94000000-0000-4000-8000-000000000004',
};

const PARTNER_A = userId('USER_A_PARTNER');
const MANAGER_A = userId('USER_A_MANAGER');
const SENIOR_A = userId('USER_A_SENIOR');
const PARTNER_B = userId('USER_B_PARTNER');

let partnerA: string;
let managerA: string;
let seniorA: string;
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
    delete from public.client_relationships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.contacts where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.registrations where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.legal_entities where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.clients where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(async () => {
  cleanFixture();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-020 Audit Firm A'),
      ('${FIRM_B}', 'IMP-020 Audit Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.managerA}', '${FIRM_A}', '${MANAGER_A}', 'manager', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${SENIOR_A}',  'senior',  'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;
  `);
  // Seeding itself writes system-actor audit rows (firms/memberships);
  // remove them so visibility assertions below see only the rows produced
  // by the mutations under test.
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
  partnerA = (await signIn(userEmail('USER_A_PARTNER'))).token;
  managerA = (await signIn(userEmail('USER_A_MANAGER'))).token;
  seniorA = (await signIn(userEmail('USER_A_SENIOR'))).token;
  partnerB = (await signIn(userEmail('USER_B_PARTNER'))).token;
});

afterAll(() => {
  cleanFixture();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('TEST-AUD-01 — client hierarchy: complete old/new per mutation', () => {
  it('client INSERT produces one audited row with actor/firm from reality, not headers', async () => {
    const created = await api(partnerA, 'POST', 'clients', {
      headers: {
        ...H(FIRM_A),
        // Forged identity/firm context — must be ignored by the audit path.
        'x-actor-id': SENIOR_A,
        'x-actor-type': 'service',
        'x-firm-id': FIRM_B,
        'x-service-name': 'forged-cron',
      },
      body: {
        firm_id: FIRM_A,
        name: 'Audited Client One',
        owner_partner_membership_id: M.partnerA,
        manager_membership_id: M.managerA,
      },
    });
    expect(created.status).toBe(201);
    const id = created.body[0].id;

    const rows = auditRows(`object_type = 'client' and object_id = '${id}'`);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe('insert');
    expect(row.actor_type).toBe('human');
    expect(row.actor_user_id).toBe(PARTNER_A); // auth.uid(), never the forged header
    expect(row.firm_id).toBe(FIRM_A); // from the row, never the forged header
    expect(row.old_value).toBeNull();
    expect(row.new_value).toMatchObject({
      name: 'Audited Client One',
      firm_id: FIRM_A,
      owner_partner_membership_id: M.partnerA,
    });
  });

  it('client UPDATE captures before and after values in one row', async () => {
    const clientId = psql(
      `select id from public.clients where firm_id = '${FIRM_A}' and name = 'Audited Client One'`,
    ).trim();
    const updated = await api(partnerA, 'PATCH', `clients?id=eq.${clientId}`, {
      headers: H(FIRM_A),
      body: { industry: 'Manufacturing', status: 'active' },
    });
    expect(updated.status).toBe(200);

    const rows = auditRows(`object_type = 'client' and object_id = '${clientId}' and action = 'update'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].old_value).toMatchObject({ industry: null, status: 'onboarding' });
    expect(rows[0].new_value).toMatchObject({ industry: 'Manufacturing', status: 'active' });
  });

  it('entity / registration / contact / relationship mutations are each audited with correct object types', async () => {
    const clientId = psql(
      `select id from public.clients where firm_id = '${FIRM_A}' and name = 'Audited Client One'`,
    ).trim();

    const entity = await api(partnerA, 'POST', 'legal_entities', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: clientId,
        entity_type: 'private_limited',
        legal_name: 'Audited Entity One',
      },
    });
    expect(entity.status).toBe(201);
    const entityId = entity.body[0].id;

    const registration = await api(partnerA, 'POST', 'registrations', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        legal_entity_id: entityId,
        type: 'GSTIN',
        value: '27AUDIT0000A1Z5',
        state: 'Maharashtra',
      },
    });
    expect(registration.status).toBe(201);

    const contact = await api(partnerA, 'POST', 'contacts', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: clientId,
        name: 'Audited Contact',
        email: 'audit@contact.example',
        is_primary: true,
      },
    });
    expect(contact.status).toBe(201);

    const entity2 = await api(partnerA, 'POST', 'legal_entities', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        client_id: clientId,
        entity_type: 'llp',
        legal_name: 'Audited Entity Two',
      },
    });
    const relationship = await api(partnerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        from_entity_id: entityId,
        to_entity_id: entity2.body[0].id,
        relation_type: 'group',
      },
    });
    expect(relationship.status).toBe(201);

    const expectations: Array<[string, string]> = [
      ['legal_entity', entityId],
      ['registration', registration.body[0].id],
      ['contact', contact.body[0].id],
      ['client_relationship', relationship.body[0].id],
    ];
    for (const [objectType, objectId] of expectations) {
      const rows = auditRows(`object_type = '${objectType}' and object_id = '${objectId}'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_user_id).toBe(PARTNER_A);
      expect(rows[0].firm_id).toBe(FIRM_A);
      expect(rows[0].action).toBe('insert');
    }
  });

  it('a denied mutation produces NO audit row (atomic fail-closed)', async () => {
    const denied = await api(seniorA, 'POST', 'clients', {
      headers: H(FIRM_A),
      body: {
        firm_id: FIRM_A,
        name: 'Denied Senior Client',
        owner_partner_membership_id: M.partnerA,
      },
    });
    expect(denied.status).toBe(403);
    expect(
      auditRows(`object_type = 'client' and new_value ->> 'name' = 'Denied Senior Client'`),
    ).toEqual([]);
  });

  it('manager writes are audited with the manager as actor (no spoofing via role headers)', async () => {
    const created = await api(managerA, 'POST', 'clients', {
      headers: { ...H(FIRM_A), 'x-role': 'partner' },
      body: {
        firm_id: FIRM_A,
        name: 'Audited Manager Client',
        owner_partner_membership_id: M.partnerA,
        manager_membership_id: M.managerA,
      },
    });
    expect(created.status).toBe(201);
    const rows = auditRows(`object_type = 'client' and object_id = '${created.body[0].id}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(MANAGER_A);
  });

  it('relationship policy (closure §12): allowed manager edge audited once, denied edge not at all', async () => {
    // Two portfolio entities (client managed by managerA) + one out-of-portfolio
    // entity (unmanaged client), created by the partner.
    const mkEntity = async (clientName: string, manager: string | null, entityName: string) => {
      const client = await api(partnerA, 'POST', 'clients', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          name: clientName,
          owner_partner_membership_id: M.partnerA,
          ...(manager ? { manager_membership_id: manager } : {}),
        },
      });
      expect(client.status).toBe(201);
      const entity = await api(partnerA, 'POST', 'legal_entities', {
        headers: H(FIRM_A),
        body: {
          firm_id: FIRM_A,
          client_id: client.body[0].id,
          entity_type: 'llp',
          legal_name: entityName,
        },
      });
      expect(entity.status).toBe(201);
      return entity.body[0].id as string;
    };
    const e1 = await mkEntity('Aud Rel Client P1', M.managerA, 'Aud Rel Entity P1');
    const e2 = await mkEntity('Aud Rel Client P2', M.managerA, 'Aud Rel Entity P2');
    const eOut = await mkEntity('Aud Rel Client Out', null, 'Aud Rel Entity Out');

    // Allowed: both endpoints in the manager's portfolio -> exactly one row.
    const allowed = await api(managerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, from_entity_id: e1, to_entity_id: e2, relation_type: 'group' },
    });
    expect(allowed.status).toBe(201);
    const allowedRows = auditRows(
      `object_type = 'client_relationship' and object_id = '${allowed.body[0].id}'`,
    );
    expect(allowedRows).toHaveLength(1);
    expect(allowedRows[0].actor_user_id).toBe(MANAGER_A);
    expect(allowedRows[0].firm_id).toBe(FIRM_A);
    expect(allowedRows[0].action).toBe('insert');

    // Denied: one endpoint outside the portfolio -> 403 and zero audit rows.
    const denied = await api(managerA, 'POST', 'client_relationships', {
      headers: H(FIRM_A),
      body: { firm_id: FIRM_A, from_entity_id: e1, to_entity_id: eOut, relation_type: 'holding' },
    });
    expect(denied.status).toBe(403);
    const deniedRows = auditRows(
      `object_type = 'client_relationship' and new_value ->> 'to_entity_id' = '${eOut}'`,
    );
    expect(deniedRows).toEqual([]);
  });
});

describe('RLS-AUD-01 — audit visibility for client-hierarchy rows', () => {
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
