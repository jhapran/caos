/**
 * IMP-061 — Structured global search integration tests: TENANT ISOLATION
 * (TEST-API-22, API-R0-SRC, IMP061-R6/R7, RLS-CTX-02, API-ERR-02).
 *
 * Drives public.structured_search(p_query text) through raw PostgREST RPC
 * calls with signed-in tokens + the untrusted x-active-firm selector.
 * Proves:
 *   - cross-firm isolation by NAME: the FSB partner cannot surface FSA rows
 *     ('Zephyr Textiles' → zero hits);
 *   - cross-firm isolation by IDENTIFIER: the deliberately identical PAN
 *     value 'Zephyr1234F' exists in both firms — exact and prefix queries
 *     return ONLY the caller-firm registration (masked, R7);
 *   - cross-firm isolation by STAFF NAME COLLISION: both firms carry an
 *     ACTIVE member whose profile full_name is exactly 'Zephyr Partner' —
 *     the FSB partner's staff hit is ONLY the FSB membership (the staff
 *     branch is pinned through ACTIVE firm_memberships of the SELECTED
 *     active firm; a same-named profile in another firm can never leak);
 *   - hidden is indistinguishable from nonexistent (API-ERR-02): an FSA
 *     partner searching the FSB-only term 'Bazar' under the FSA selector
 *     gets exactly the same 200 [] shape as a truly nonexistent term;
 *   - the selector grants nothing (RLS-CTX-02): a FORGED x-active-firm
 *     header naming a firm the caller has no ACTIVE membership in yields
 *     zero rows for a term that is rich in the caller's own firm;
 *   - anonymous callers (apikey only, no token) are refused — EXECUTE is
 *     authenticated-only (401 / 42501), never data;
 *   - NO firm_id argument exists (API-CONV-05): calling with an extra
 *     p_firm_id argument is rejected by PostgREST (unknown function
 *     signature) — firm context cannot be smuggled in as an argument.
 *
 * Fixture discipline: identical suite-owned firms/fixtures as the
 * search-contract suite (6f630000-… range, deterministic ids, force-reset
 * in beforeAll, scoped audit/outbox/profile noise cleanup, guarded firm
 * delete in afterAll). Operator psql is fixture setup/teardown ONLY —
 * every behavior assertion goes through PostgREST with signed-in tokens.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm } from '@/data/context';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, localEnv, psql, signIn, userEmail, userId } from '../helpers.mjs';

// This suite owns TWO dedicated firms — never the shared registry FIRM_A/B.
const FSA = '6f630000-0000-4000-8000-000000000001';
const FSB = '6f630000-0000-4000-8000-000000000002';
const ALL_FIRMS = [FSA, FSB];
const FIRM_LIST = ALL_FIRMS.map((f) => `'${f}'`).join(',');
const H = (firm: string) => ({ 'x-active-firm': firm });

const id = (suffix: string) => `6f630000-0000-4000-8000-0000000000${suffix}`;

const M = {
  superA: id('11'),
  pA: id('12'),
  mA: id('13'),
  sA: id('14'),
  arA: id('15'),
  bA: id('16'),
  suspA: id('17'),
  remA: id('18'),
  invA: id('19'),
  pB: id('1a'),
  sB: id('1b'),
};
const C = {
  cZ1: id('21'),
  cZ2: id('22'),
  cAz: id('23'),
  cOff: id('24'),
  cLit: id('25'),
  cB: id('26'),
  cCap: ['61', '62', '63', '64', '65', '66'].map(id),
};
const E = {
  eZ1: id('31'),
  eZ2: id('32'),
  eAz: id('33'),
  eOff: id('34'),
  eB: id('35'),
  eCap: ['71', '72', '73', '74', '75', '76'].map(id),
};
const R = {
  rZ1: id('41'),
  rZ2: id('42'),
  rB: id('43'),
  rCap: ['81', '82', '83', '84', '85', '86'].map(id),
};
const T = {
  tZ1: id('51'),
  tZ2: id('52'),
  tAz: id('53'),
  tB: id('54'),
  tCap: ['91', '92', '93', '94', '95', '96'].map(id),
};
const I = {
  iZ1: id('a1'),
  iZ2: id('a2'),
  iAz: id('a3'),
  iB: id('a4'),
  iCap: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map(id),
};

const SYS_ITR = '50000000-0000-4000-8000-000000000005';
const ORDINAL = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];

const PROFILE_NAMES: Array<[string, string]> = [
  ['USER_A_PARTNER', 'Zephyr Partner'],
  ['USER_A_SENIOR', 'Zephyr Senior'],
  ['USER_A_SUSPENDED', 'Zephyr Suspended'],
  ['USER_A_REMOVED', 'Zephyr Removed'],
  ['USER_CLIENT_OVERLAP', 'Zephyr Invited'],
  ['USER_B_PARTNER', 'Zephyr Partner'],
  ['USER_B_SENIOR', 'Zephyr Senior B'],
];
const TOUCHED_USERS = PROFILE_NAMES.map(([key]) => userId(key));
const TOUCHED_USER_LIST = TOUCHED_USERS.map((u) => `'${u}'`).join(',');

interface SearchRow {
  kind: string;
  id: string;
  label: string;
  sub: string | null;
  href: string | null;
  match_class: string;
  status: string | null;
}

async function tokenFor(userKey: string): Promise<string> {
  const s = await signIn(userEmail(userKey));
  if (!s.ok) throw new Error(`sign-in failed for ${userKey}: ${JSON.stringify(s.raw)}`);
  return s.token;
}

async function rpcSearch(userKey: string, firm: string, query: string): Promise<SearchRow[]> {
  const token = await tokenFor(userKey);
  const res = await api(token, 'POST', 'rpc/structured_search', {
    headers: H(firm),
    body: { p_query: query },
  });
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  return res.body as SearchRow[];
}

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in (${FIRM_LIST});
    delete from public.event_outbox where firm_id in (${FIRM_LIST});
    delete from public.tasks where firm_id in (${FIRM_LIST});
    delete from public.compliance_instances where firm_id in (${FIRM_LIST});
    delete from public.registrations where firm_id in (${FIRM_LIST});
    delete from public.legal_entities where firm_id in (${FIRM_LIST});
    delete from public.clients where firm_id in (${FIRM_LIST});
    delete from public.firm_memberships where firm_id in (${FIRM_LIST});
  `);
}

function cleanProfileNoise() {
  psql(`
    delete from public.audit_log
      where object_type = 'profile' and object_id in (${TOUCHED_USER_LIST});
  `);
}

function seedFixtures() {
  psql(`
    insert into public.firms (id, name) values
      ('${FSA}', 'IMP-061 SRC Firm A'),
      ('${FSB}', 'IMP-061 SRC Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superA}', '${FSA}', '${userId('USER_A_SUPER_ADMIN')}', 'super_admin',       'active'),
      ('${M.pA}',     '${FSA}', '${userId('USER_A_PARTNER')}',     'partner',           'active'),
      ('${M.mA}',     '${FSA}', '${userId('USER_A_MANAGER')}',     'manager',           'active'),
      ('${M.sA}',     '${FSA}', '${userId('USER_A_SENIOR')}',      'senior',            'active'),
      ('${M.arA}',    '${FSA}', '${userId('USER_A_ARTICLE')}',     'article_executive', 'active'),
      ('${M.bA}',     '${FSA}', '${userId('USER_A_BILLING')}',     'billing',           'active'),
      ('${M.suspA}',  '${FSA}', '${userId('USER_A_SUSPENDED')}',   'senior',            'suspended'),
      ('${M.remA}',   '${FSA}', '${userId('USER_A_REMOVED')}',     'senior',            'removed'),
      ('${M.invA}',   '${FSA}', '${userId('USER_CLIENT_OVERLAP')}', 'senior',           'invited'),
      ('${M.pB}',     '${FSB}', '${userId('USER_B_PARTNER')}',     'partner',           'active'),
      ('${M.sB}',     '${FSB}', '${userId('USER_B_SENIOR')}',      'senior',            'active')
    on conflict (firm_id, user_id) do nothing;

    update public.firm_memberships m set status = v.status, role = v.role
      from (values
        ('${M.superA}'::uuid, 'super_admin',       'active'),
        ('${M.pA}'::uuid,     'partner',           'active'),
        ('${M.mA}'::uuid,     'manager',           'active'),
        ('${M.sA}'::uuid,     'senior',            'active'),
        ('${M.arA}'::uuid,    'article_executive', 'active'),
        ('${M.bA}'::uuid,     'billing',           'active'),
        ('${M.suspA}'::uuid,  'senior',            'suspended'),
        ('${M.remA}'::uuid,   'senior',            'removed'),
        ('${M.invA}'::uuid,   'senior',            'invited'),
        ('${M.pB}'::uuid,     'partner',           'active'),
        ('${M.sB}'::uuid,     'senior',            'active')
      ) as v(id, role, status)
      where m.id = v.id;

    insert into public.profiles (id, full_name) values
      ${PROFILE_NAMES.map(([key, name]) => `('${userId(key)}', '${name}')`).join(',\n      ')}
    on conflict (id) do update set full_name = excluded.full_name;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.cZ1}',  '${FSA}', 'Zephyr Textiles',       '${M.pA}', '${M.mA}', 'active'),
      ('${C.cZ2}',  '${FSA}', 'Zephyr Pharma',         '${M.pA}', '${M.mA}', 'active'),
      ('${C.cAz}',  '${FSA}', 'Azure Zephyr Traders',  '${M.pA}', null,      'active'),
      ('${C.cOff}', '${FSA}', 'Offboarded Components', '${M.pA}', '${M.mA}', 'offboarded'),
      ('${C.cLit}', '${FSA}', 'Litmus % Supply',       '${M.pA}', '${M.mA}', 'active'),
      ('${C.cB}',   '${FSB}', 'Zephyr Bazar',          '${M.pB}', null,      'active'),
      ${ORDINAL.map((n, i) => `('${C.cCap[i]}', '${FSA}', 'Captest ${n}', '${M.pA}', '${M.mA}', 'active')`).join(',\n      ')};

    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.eZ1}',  '${FSA}', '${C.cZ1}',  'private_limited', 'Zephyr Holdings Pvt Ltd'),
      ('${E.eZ2}',  '${FSA}', '${C.cZ2}',  'private_limited', 'Zephyr Pharma Entity'),
      ('${E.eAz}',  '${FSA}', '${C.cAz}',  'private_limited', 'Azure Entity One'),
      ('${E.eOff}', '${FSA}', '${C.cOff}', 'private_limited', 'Offboarded Entity'),
      ('${E.eB}',   '${FSB}', '${C.cB}',   'private_limited', 'Zephyr Bazar Entity'),
      ${ORDINAL.map((n, i) => `('${E.eCap[i]}', '${FSA}', '${C.cCap[i]}', 'private_limited', 'Captest Entity ${n}')`).join(',\n      ')};

    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state) values
      ('${R.rZ1}', '${FSA}', '${E.eZ1}', 'PAN', 'Zephyr1234F', null),
      ('${R.rZ2}', '${FSA}', '${E.eZ2}', 'PAN', 'Zephyr5678K', null),
      ('${R.rB}',  '${FSB}', '${E.eB}',  'PAN', 'Zephyr1234F', null),
      ${ORDINAL.map((_, i) => `('${R.rCap[i]}', '${FSA}', '${E.eCap[i]}', 'GSTIN', 'CaptestC00${i + 1}Z', 'MH')`).join(',\n      ')};

    insert into public.compliance_instances
      (id, firm_id, legal_entity_id, compliance_type_id, period_start, period_end,
       period_label, due_date, state, assignee_membership_id)
    values
      ('${I.iZ1}', '${FSA}', '${E.eZ1}', '${SYS_ITR}', '2026-04-01', '2027-03-31',
       'Zephyr FY 2026-27', ((now() at time zone 'Asia/Kolkata')::date + 30), 'preparation', '${M.sA}'),
      ('${I.iZ2}', '${FSA}', '${E.eZ2}', '${SYS_ITR}', '2027-04-01', '2028-03-31',
       'Zephyr FY 2027-28', ((now() at time zone 'Asia/Kolkata')::date + 60), 'not_started', null),
      ('${I.iAz}', '${FSA}', '${E.eAz}', '${SYS_ITR}', '2026-04-01', '2027-03-31',
       'Azure FY 2026-27', ((now() at time zone 'Asia/Kolkata')::date + 90), 'not_started', null),
      ('${I.iB}',  '${FSB}', '${E.eB}',  '${SYS_ITR}', '2026-04-01', '2027-03-31',
       'Zephyr FY 2026-27', ((now() at time zone 'Asia/Kolkata')::date + 30), 'preparation', null),
      ${ORDINAL.map((n, i) => `('${I.iCap[i]}', '${FSA}', '${E.eCap[i]}', '${SYS_ITR}', '2026-04-01', '2027-03-31',
       'Captest period ${n}', ((now() at time zone 'Asia/Kolkata')::date + 45), 'not_started', null)`).join(',\n      ')};

    insert into public.tasks (id, firm_id, client_id, title, next_action, assignee_membership_id) values
      ('${T.tZ1}', '${FSA}', '${C.cZ1}', 'Zephyr GSTR-1 reconciliation', 'reconcile', '${M.sA}'),
      ('${T.tZ2}', '${FSA}', '${C.cZ1}', 'Zephyr payroll prep',          'prepare',   null),
      ('${T.tAz}', '${FSA}', '${C.cAz}', 'Zephyr audit followup',        'follow up', null),
      ('${T.tB}',  '${FSB}', '${C.cB}',  'Zephyr Bazar filing',          'file',      null),
      ${ORDINAL.map((n, i) => `('${T.tCap[i]}', '${FSA}', '${C.cCap[i]}', 'Captest task ${n}', 'x', null)`).join(',\n      ')};
  `);
  psql(`
    delete from public.audit_log where firm_id in (${FIRM_LIST});
    delete from public.event_outbox where firm_id in (${FIRM_LIST});
  `);
  cleanProfileNoise();
}

beforeAll(() => {
  cleanRows();
  cleanProfileNoise();
  seedFixtures();
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.profiles where id in (${TOUCHED_USER_LIST});
    delete from public.firms where id in (${FIRM_LIST})
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
    delete from public.audit_log where firm_id in (${FIRM_LIST});
    delete from public.event_outbox where firm_id in (${FIRM_LIST});
  `);
  cleanProfileNoise();
});

describe('TEST-API-22 — API-R0-SRC structured-search tenant isolation', () => {
  it('by name: the FSB partner cannot surface FSA rows', async () => {
    expect(await rpcSearch('USER_B_PARTNER', FSB, 'Zephyr Textiles')).toEqual([]);
    // Sanity: the same query is rich for the FSA partner — the zero above
    // is isolation, not a dead function.
    const fsaRows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr Textiles');
    expect(fsaRows.some((r) => r.id === C.cZ1 && r.kind === 'client')).toBe(true);
  });

  it("by exact identifier: the cross-firm identical PAN 'Zephyr1234F' returns ONLY the FSB registration, masked", async () => {
    const rows = await rpcSearch('USER_B_PARTNER', FSB, 'Zephyr1234F');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'registration',
      id: R.rB,
      label: 'PAN ····234F',
      match_class: 'exact',
      href: `/clients/${C.cB}`,
    });
    expect(JSON.stringify(rows)).not.toContain('Zephyr1234F');
  });

  it('by identifier prefix: a prefix query returns ONLY the caller-firm registration', async () => {
    const rows = await rpcSearch('USER_B_PARTNER', FSB, 'Zephyr1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'registration', id: R.rB, match_class: 'prefix' });
  });

  it("by staff name collision: 'Zephyr Partner' exists in BOTH firms — the hit is ONLY the FSB membership", async () => {
    const rows = await rpcSearch('USER_B_PARTNER', FSB, 'Zephyr Partner');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'staff',
      id: M.pB,
      label: 'Zephyr Partner',
      sub: 'Team · partner',
      href: null,
    });
    // The FSA membership with the identically-named profile never crosses.
    expect(rows.some((r) => r.id === M.pA)).toBe(false);
  });

  it('hidden is indistinguishable from nonexistent (API-ERR-02): FSB-only term under the FSA selector == a nonexistent term', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const hidden = await api(token, 'POST', 'rpc/structured_search', {
      headers: H(FSA),
      body: { p_query: 'Bazar' }, // FSB-only data ('Zephyr Bazar' chain)
    });
    const nonexistent = await api(token, 'POST', 'rpc/structured_search', {
      headers: H(FSA),
      body: { p_query: 'zz-no-such-thing' },
    });
    expect(hidden.status).toBe(200);
    expect(hidden.body).toEqual([]);
    // One identical surface: same status, same empty-body shape.
    expect(nonexistent.status).toBe(hidden.status);
    expect(nonexistent.body).toEqual(hidden.body);
  });

  it('forged selector grants nothing (RLS-CTX-02): FSA partner token + FSB header → zero rows for a rich term', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const res = await api(token, 'POST', 'rpc/structured_search', {
      headers: H(FSB), // the caller holds NO FSB membership
      body: { p_query: 'Zephyr' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    // Control: the same token with its truthful selector sees FSA rows.
    const truthful = await api(token, 'POST', 'rpc/structured_search', {
      headers: H(FSA),
      body: { p_query: 'Zephyr' },
    });
    expect(truthful.status).toBe(200);
    expect((truthful.body as SearchRow[]).length).toBeGreaterThan(0);
  });

  it('anonymous (apikey only, no token) is refused — EXECUTE is authenticated-only, never data', async () => {
    const { ANON_KEY } = localEnv();
    const res = await api(ANON_KEY, 'POST', 'rpc/structured_search', {
      headers: H(FSA),
      body: { p_query: 'Zephyr' },
    });
    expect([401, 403]).toContain(res.status);
    expect(res.body?.code).toBe('42501');
    expect(Array.isArray(res.body)).toBe(false);
  });

  it('no firm_id argument exists (API-CONV-05): an extra p_firm_id argument is rejected, never honored', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const res = await api(token, 'POST', 'rpc/structured_search', {
      headers: H(FSA),
      body: { p_query: 'Zephyr', p_firm_id: FSB },
    });
    // PostgREST resolves RPCs by name + argument list: no such function
    // signature exists, so the call is refused outright (PGRST202 / 404) —
    // firm context can never be smuggled in as an argument.
    expect(res.status).toBe(404);
    expect(res.body?.code).toBe('PGRST202');
    expect(Array.isArray(res.body)).toBe(false);
  });
});
