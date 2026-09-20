/**
 * IMP-061 — Structured global search integration tests: ROLE MATRIX
 * (TEST-API-24, API-R0-SRC, IMP061-R6, M1-A, RLS-* scoped SELECT policies).
 *
 * The function is SECURITY INVOKER: every branch is filtered by the
 * caller's ORDINARY RLS, so the search role matrix IS the underlying table
 * matrix. Drives raw PostgREST RPC calls per persona (plus the REAL
 * searchService adapter for partner + senior) and proves:
 *   - partner (FSA): full firm scope across all six kinds; type-name
 *     matching works (compliance_types is a manager-plus read) — 'Income
 *     Tax' returns compliance_instance hits labelled
 *     'Income Tax Return — <period_label>';
 *   - manager (FSA): PORTFOLIO scope only — the cAz chain (manager NULL)
 *     never surfaces in any kind ('Azure' → 200 []), while the portfolio
 *     cZ1/cZ2 chains do; type-name matching works;
 *   - senior (FSA): NO client/entity/registration hits; ONLY the assigned
 *     task tZ1 and the assigned instance iZ1; iZ1's label is EXACTLY the
 *     period_label 'Zephyr FY 2026-27' (M1-A LEFT JOIN degradation — the
 *     hidden type name never appears); a type-name query 'Income Tax'
 *     returns ZERO instance hits (no type-name leak) while the
 *     period_label query 'Zephyr FY' DOES return iZ1 (no INNER-JOIN
 *     disappearance); the staff roster stays visible;
 *   - article (FSA): nothing assigned → staff hits only;
 *   - billing (FSA): no client/entity/registration/task/instance reads in
 *     R0, but the ACTIVE-membership roster and shared-firm profiles ARE
 *     visible → staff hits only (never a fabricated zero-result claim);
 *   - staff roster pin (R6): the partner's 'Zephyr' staff hits are EXACTLY
 *     the ACTIVE FSA memberships with matching profile names — never the
 *     suspended/removed/invited memberships, never the FSB membership
 *     whose profile carries the identical 'Zephyr Partner' name.
 *
 * Fixture discipline: identical suite-owned firms/fixtures as the
 * search-contract suite. Operator psql is fixture setup/teardown ONLY.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { searchService } from '@/data/search/index';
import type { StructuredSearchHit } from '@/data/search/index';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, PASSWORD, psql, signIn, userEmail, userId } from '../helpers.mjs';

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

async function serviceSearchAs(userKey: string, firm: string, query: string): Promise<StructuredSearchHit[]> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: userEmail(userKey),
    password: PASSWORD,
  });
  expect(error).toBeNull();
  setActiveFirm(firm);
  return searchService.searchStructured(query);
}

const kindsOf = (rows: SearchRow[]) => [...new Set(rows.map((r) => r.kind))].sort();
const idsOfKind = (rows: SearchRow[], kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.id);

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

describe('TEST-API-24 — API-R0-SRC structured-search role matrix', () => {
  it('partner: full firm scope — all six kinds; type-name matching labels instances with the type name', async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    expect(kindsOf(rows)).toEqual([
      'client',
      'compliance_instance',
      'legal_entity',
      'registration',
      'staff',
      'task',
    ]);

    // Type-name matching (M1-A): compliance_types is readable by a partner,
    // so 'Income Tax' matches via ct.name and the label carries it.
    const byType = await rpcSearch('USER_A_PARTNER', FSA, 'Income Tax');
    const instances = byType.filter((r) => r.kind === 'compliance_instance');
    expect(instances.length).toBeGreaterThan(0);
    for (const hit of instances) {
      expect(hit.label.startsWith('Income Tax Return — ')).toBe(true);
    }
    const iZ1 = instances.find((r) => r.id === I.iZ1);
    expect(iZ1?.label).toBe('Income Tax Return — Zephyr FY 2026-27');
    // Per-kind cap applies to the type-name branch too (9 matching instances).
    expect(instances.length).toBeLessThanOrEqual(5);
  });

  it('manager: portfolio scope — the cZ1/cZ2 chains surface, the cAz chain never does; type-name matching works', async () => {
    const rows = await rpcSearch('USER_A_MANAGER', FSA, 'Zephyr');
    expect(idsOfKind(rows, 'client')).toEqual([C.cZ1, C.cZ2]); // cAz (manager NULL) absent
    expect(idsOfKind(rows, 'legal_entity')).toEqual([E.eZ1, E.eZ2]);
    expect(idsOfKind(rows, 'registration')).toEqual([R.rZ1, R.rZ2]);
    expect(idsOfKind(rows, 'task')).toEqual([T.tZ1, T.tZ2]); // tAz absent
    expect(idsOfKind(rows, 'compliance_instance')).toEqual([I.iZ1, I.iZ2]); // iAz absent
    // The roster is firm-wide for any ACTIVE member.
    expect(idsOfKind(rows, 'staff')).toEqual([M.pA, M.sA]);

    // The entire out-of-portfolio chain is invisible: 'Azure' is a
    // truthful empty for the manager, never an error.
    expect(await rpcSearch('USER_A_MANAGER', FSA, 'Azure')).toEqual([]);

    // Type-name matching works for a manager (compliance_types readable),
    // scoped to the portfolio: iAz (cAz chain) never matches.
    const byType = await rpcSearch('USER_A_MANAGER', FSA, 'Income Tax');
    const instances = idsOfKind(byType, 'compliance_instance');
    expect(instances.length).toBeGreaterThan(0);
    expect(instances).toContain(I.iZ1);
    expect(instances).not.toContain(I.iAz);
    for (const hit of byType.filter((r) => r.kind === 'compliance_instance')) {
      expect(hit.label.startsWith('Income Tax Return — ')).toBe(true);
    }
  });

  it('senior: assigned-only — tZ1 + iZ1; the instance label is EXACTLY the period_label (hidden type name never leaks)', async () => {
    const rows = await rpcSearch('USER_A_SENIOR', FSA, 'Zephyr');
    // NO client / legal_entity / registration reads in R0.
    expect(kindsOf(rows)).toEqual(['compliance_instance', 'staff', 'task']);
    expect(idsOfKind(rows, 'task')).toEqual([T.tZ1]); // assignee-only; tZ2 unassigned
    expect(idsOfKind(rows, 'compliance_instance')).toEqual([I.iZ1]);
    expect(idsOfKind(rows, 'staff')).toEqual([M.pA, M.sA]);

    // M1-A LEFT JOIN degradation: the type name is NOT readable by a
    // senior, so the label degrades to the bare period_label.
    const iZ1 = rows.find((r) => r.id === I.iZ1);
    expect(iZ1?.label).toBe('Zephyr FY 2026-27');
    expect(iZ1?.href).toBeNull();
  });

  it("senior: a type-name query returns ZERO instance hits (no leak), while the period_label query DOES return iZ1", async () => {
    // 'Income Tax' would match only through ct.name — invisible to a
    // senior, so it can neither match nor label.
    expect(await rpcSearch('USER_A_SENIOR', FSA, 'Income Tax')).toEqual([]);

    // The instance never disappears behind the LEFT JOIN: period_label
    // matching still works without the type row.
    const rows = await rpcSearch('USER_A_SENIOR', FSA, 'Zephyr FY');
    expect(rows.map((r) => r.id)).toEqual([I.iZ1]);
    expect(rows[0]).toMatchObject({
      kind: 'compliance_instance',
      label: 'Zephyr FY 2026-27',
      match_class: 'prefix',
      href: null,
    });
  });

  it('article: nothing assigned — staff hits only', async () => {
    const rows = await rpcSearch('USER_A_ARTICLE', FSA, 'Zephyr');
    expect(rows.length).toBeGreaterThan(0);
    expect(kindsOf(rows)).toEqual(['staff']);
    expect(idsOfKind(rows, 'staff')).toEqual([M.pA, M.sA]);
  });

  it('billing: staff hits DO work; every other kind is absent (no fabricated zero-result claim)', async () => {
    const rows = await rpcSearch('USER_A_BILLING', FSA, 'Zephyr');
    expect(rows.length).toBeGreaterThan(0);
    expect(kindsOf(rows)).toEqual(['staff']);
    expect(idsOfKind(rows, 'staff')).toEqual([M.pA, M.sA]);
    // Explicitly: no domain rows of any other kind.
    for (const kind of ['client', 'legal_entity', 'registration', 'task', 'compliance_instance']) {
      expect(idsOfKind(rows, kind), kind).toEqual([]);
    }
  });

  it('staff roster pin (R6): exactly the ACTIVE FSA memberships — never suspended/removed/invited, never the same-named FSB member', async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    const staff = rows.filter((r) => r.kind === 'staff');
    expect(staff.map((r) => r.id)).toEqual([M.pA, M.sA]);
    expect(staff.map((r) => r.label)).toEqual(['Zephyr Partner', 'Zephyr Senior']);
    expect(staff.map((r) => r.sub)).toEqual(['Team · partner', 'Team · senior']);
    // The non-ACTIVE memberships with matching profile names never appear…
    for (const forbidden of [M.suspA, M.remA, M.invA]) {
      expect(staff.some((r) => r.id === forbidden)).toBe(false);
    }
    // … and neither does the FSB 'Zephyr Partner' membership — profile
    // visibility across firms can never create a staff hit outside the
    // selected active firm.
    expect(staff.some((r) => r.id === M.pB)).toBe(false);
    expect(JSON.stringify(staff)).not.toContain('Zephyr Senior B');
  });

  it('adapter path: partner full scope and senior degradation hold through the REAL searchService', async () => {
    const partnerHits = await serviceSearchAs('USER_A_PARTNER', FSA, 'Zephyr');
    expect([...new Set(partnerHits.map((h) => h.kind))].sort()).toEqual([
      'client',
      'compliance_instance',
      'legal_entity',
      'registration',
      'staff',
      'task',
    ]);
    const partnerType = await searchService.searchStructured('Income Tax');
    const partnerInstance = partnerType.find((h) => h.id === I.iZ1);
    expect(partnerInstance?.label).toBe('Income Tax Return — Zephyr FY 2026-27');

    const seniorHits = await serviceSearchAs('USER_A_SENIOR', FSA, 'Zephyr');
    expect([...new Set(seniorHits.map((h) => h.kind))].sort()).toEqual([
      'compliance_instance',
      'staff',
      'task',
    ]);
    const seniorIZ1 = seniorHits.find((h) => h.id === I.iZ1);
    expect(seniorIZ1?.label).toBe('Zephyr FY 2026-27');
    expect(seniorIZ1?.href).toBeNull();
    const seniorTask = seniorHits.find((h) => h.kind === 'task');
    expect(seniorTask?.id).toBe(T.tZ1);
    expect(seniorTask?.href).toBeNull();

    // No type-name leak through the adapter either.
    expect(await searchService.searchStructured('Income Tax')).toEqual([]);
  });
});
