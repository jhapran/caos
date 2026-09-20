/**
 * IMP-061 — Structured global search integration tests: MATCHING SEMANTICS
 * (TEST-API-23, API-R0-SRC, IMP061-R3/R4/R5).
 *
 * Drives public.structured_search(p_query text) through raw PostgREST RPC
 * calls as the FSA partner with the FSA selector. Proves:
 *   - R4 server-side minimum length: trimmed input shorter than 2
 *     characters ('', ' ', 'z') returns 200 with ZERO rows — never an
 *     error, never an enumeration of tenant data;
 *   - R3-B identifier semantics (registrations.value): EXACT → match_class
 *     'exact'; case-SENSITIVE PREFIX → 'prefix'; substring NEVER matches
 *     ('hyr1234' → zero registration hits); case mismatch
 *     ('zephyr1234f' vs 'Zephyr1234F') → zero registration hits;
 *   - textual semantics: case-INSENSITIVE substring with prefix ranked
 *     ahead of substring-only ('zephyr' client hits order prefix-rows
 *     before the substring-only 'Azure Zephyr Traders'; 'ZEPHYR' still
 *     matches client names);
 *   - R3 literal treatment: input that would be LIKE wildcards or
 *     PostgREST operator syntax ('%%', '__', '\\\\', "''", '""', '**',
 *     ',,', '()', 'eq.', 'or(', 'and(', 'cs.', 'ilike.') is matched
 *     LITERALLY — each returns 200 with ZERO hits (a live wildcard would
 *     match everything);
 *   - STRONG literal proof: fixture client 'Litmus % Supply' — the query
 *     'Litmus %' returns EXACTLY that client (the % matched a literal %
 *     in the row), and 'Litmus % Supply X' returns ZERO rows (the
 *     trailing literal text is absent from the row);
 *   - deterministic ordering: two identical 'Zephyr' calls return
 *     identical kind:id sequences.
 *
 * Fixture discipline: identical suite-owned firms/fixtures as the
 * search-contract suite. Operator psql is fixture setup/teardown ONLY.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm } from '@/data/context';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

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

/** Raw RPC proof path returning status + body WITHOUT the usual 200
 *  assertion — several tests here assert the status itself. */
async function rpcRaw(userKey: string, firm: string, query: string) {
  const token = await tokenFor(userKey);
  return api(token, 'POST', 'rpc/structured_search', {
    headers: H(firm),
    body: { p_query: query },
  });
}

async function rpcSearch(userKey: string, firm: string, query: string): Promise<SearchRow[]> {
  const res = await rpcRaw(userKey, firm, query);
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

describe('TEST-API-23 — API-R0-SRC structured-search matching semantics', () => {
  it('minimum length (R4): trimmed input shorter than 2 characters returns 200 with zero rows', async () => {
    for (const query of ['', ' ', 'z']) {
      const res = await rpcRaw('USER_A_PARTNER', FSA, query);
      expect(res.status, JSON.stringify(query)).toBe(200);
      expect(res.body, JSON.stringify(query)).toEqual([]);
    }
  });

  it("identifier exact: 'Zephyr1234F' returns exactly one registration with match_class 'exact'", async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr1234F');
    const regs = rows.filter((r) => r.kind === 'registration');
    expect(regs).toHaveLength(1);
    expect(regs[0]).toMatchObject({ id: R.rZ1, match_class: 'exact', label: 'PAN ····234F' });
    // No textual name contains the identifier string — nothing else matches.
    expect(rows).toHaveLength(1);
  });

  it("identifier prefix: 'Zephyr1' is a case-sensitive prefix match ('prefix'), hitting rZ1 only", async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr1');
    const regs = rows.filter((r) => r.kind === 'registration');
    expect(regs.map((r) => r.id)).toEqual([R.rZ1]);
    expect(regs[0].match_class).toBe('prefix');
  });

  it("identifier substring NEVER matches: 'hyr1234' returns zero registration hits", async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'hyr1234');
    expect(rows.filter((r) => r.kind === 'registration')).toEqual([]);
    expect(rows).toEqual([]); // no textual name contains it either
  });

  it("identifier match is case-SENSITIVE: 'zephyr1234f' (lowercase) returns zero registration hits", async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'zephyr1234f');
    expect(rows.filter((r) => r.kind === 'registration')).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("textual prefix ranks ahead of substring-only: 'zephyr' client hits order prefix rows before 'Azure Zephyr Traders'", async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'zephyr');
    const clients = rows.filter((r) => r.kind === 'client');
    expect(clients.map((r) => r.id)).toEqual([C.cZ1, C.cZ2, C.cAz]);
    expect(clients.map((r) => r.match_class)).toEqual(['prefix', 'prefix', 'substring']);
  });

  it("textual match is case-INSENSITIVE: 'ZEPHYR' still matches client names", async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'ZEPHYR');
    const clients = rows.filter((r) => r.kind === 'client');
    expect(clients.map((r) => r.id)).toEqual([C.cZ1, C.cZ2, C.cAz]);
    // … while the same uppercase string is NOT a case-sensitive identifier hit.
    expect(rows.filter((r) => r.kind === 'registration')).toEqual([]);
  });

  it('literal treatment (R3): wildcard/operator-looking input matches literally — every probe returns 200 with ZERO hits', async () => {
    const probes = [
      '%%', // a live wildcard would match EVERYTHING
      '__',
      '\\\\', // two literal backslashes
      "''",
      '""',
      '**',
      ',,',
      '()',
      'eq.',
      'or(',
      'and(',
      'cs.',
      'ilike.',
    ];
    for (const query of probes) {
      const res = await rpcRaw('USER_A_PARTNER', FSA, query);
      expect(res.status, JSON.stringify(query)).toBe(200);
      expect(res.body, JSON.stringify(query)).toEqual([]);
    }
  });

  it("STRONG literal proof: 'Litmus %' hits exactly the literal-% client; 'Litmus % Supply X' hits nothing", async () => {
    const positive = await rpcSearch('USER_A_PARTNER', FSA, 'Litmus %');
    expect(positive).toHaveLength(1);
    expect(positive[0]).toMatchObject({ kind: 'client', id: C.cLit, label: 'Litmus % Supply' });

    // The trailing literal text is absent from the row: no uncontrolled
    // expansion, no truncation of the query at the % character.
    const negative = await rpcSearch('USER_A_PARTNER', FSA, 'Litmus % Supply X');
    expect(negative).toEqual([]);
  });

  it('deterministic ordering: two identical calls return identical kind:id sequences', async () => {
    const first = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    const second = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    expect(second.map((r) => `${r.kind}:${r.id}`)).toEqual(first.map((r) => `${r.kind}:${r.id}`));
    expect(second).toEqual(first);
  });
});
