/**
 * IMP-061 — Structured global search integration tests: CONTRACT surface
 * (TEST-API-21, API-R0-SRC, IMP061-R1…R11 + M1-A).
 *
 * Drives public.structured_search(p_query text) — the SECURITY INVOKER
 * function from migration 20260920000000_structured_search.sql — against
 * the REAL local stack two ways, exactly as application code does:
 *   - raw PostgREST RPC calls with a signed-in token + the untrusted
 *     x-active-firm selector (RLS-CTX-02);
 *   - the REAL searchService Supabase adapter through
 *     getSupabaseClient().auth password sign-in + setActiveFirm() (the
 *     IMP-051 deadline-readmodel / IMP-042 mywork precedent).
 *
 * NO privileged SQL is a proof mechanism: operator psql is used only for
 * fixture seed/teardown and for catalog-posture inspection (pg_proc /
 * pg_extension / migration ledger — metadata, not behavior).
 *
 * Proves:
 *   - catalog posture: exactly ONE public.structured_search, SECURITY
 *     INVOKER, STABLE, search_path='', identity arguments exactly
 *     'p_query text' (NO firm_id, API-CONV-05); EXECUTE granted to
 *     authenticated ONLY (anon / service_role / PUBLIC denied); no pg_trgm
 *     extension; exactly one structured-search migration file on disk;
 *   - a partner 'Zephyr' query returns hits of ALL SIX kinds (R1) and every
 *     row carries exactly the contract keys
 *     kind,id,label,sub,href,match_class,status;
 *   - the R11-A destination matrix: client/legal_entity/registration →
 *     '/clients/<clientId>' (entity/registration via the authorized parent
 *     Client 360); task/compliance_instance/staff → null;
 *   - R7 masking: registration label is '<TYPE> ····<last4>' and the raw
 *     identifier value appears NOWHERE in the JSON payload;
 *   - R10: an offboarded client stays searchable with status 'offboarded';
 *   - R5 caps: 5 per kind / 20 global, server-side, with the canonical
 *     ordering (match class → kind rank → id ascending);
 *   - deterministic ordering: two identical calls return identical
 *     kind:id sequences;
 *   - truthful empty (API-ERR-02): an unmatched query is 200 with [];
 *   - the same expectations hold through the REAL searchService adapter
 *     (camelCase DTO keys, R4 client-side minimum guard).
 *
 * Fixture discipline (IMP-051 deadline-readmodel precedent): TWO dedicated
 * suite-owned firms in the 6f630000-… range (never the shared registry
 * FIRM_A/B), deterministic ids, force-reset on every run; fixture
 * audit/outbox/profile noise removed as the operator, scoped to THESE two
 * firms and THESE profile ids only (AUD-INV-01). Suite stays exact on any
 * run date (no date-sensitive assertions here).
 */
import { readdirSync } from 'node:fs';

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
  suspA: id('17'), // FSA senior, SUSPENDED — never a staff hit
  remA: id('18'), // FSA senior, REMOVED — never a staff hit
  invA: id('19'), // FSA senior, INVITED — never a staff hit
  pB: id('1a'), // FSB partner
  sB: id('1b'), // FSB senior
};
const C = {
  cZ1: id('21'), // FSA 'Zephyr Textiles', manager portfolio
  cZ2: id('22'), // FSA 'Zephyr Pharma', manager portfolio
  cAz: id('23'), // FSA 'Azure Zephyr Traders', manager NULL (outside portfolio)
  cOff: id('24'), // FSA 'Offboarded Components', status offboarded
  cLit: id('25'), // FSA 'Litmus % Supply' (literal-wildcard proof)
  cB: id('26'), // FSB 'Zephyr Bazar'
  cCap: ['61', '62', '63', '64', '65', '66'].map(id), // per-kind cap proof
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
  rZ1: id('41'), // PAN 'Zephyr1234F' (mixed case — identifier match is case-sensitive)
  rZ2: id('42'), // PAN 'Zephyr5678K'
  rB: id('43'), // FSB PAN 'Zephyr1234F' (deliberate cross-firm identical identifier)
  rCap: ['81', '82', '83', '84', '85', '86'].map(id),
};
const T = {
  tZ1: id('51'), // assignee senior
  tZ2: id('52'),
  tAz: id('53'), // outside the manager portfolio
  tB: id('54'),
  tCap: ['91', '92', '93', '94', '95', '96'].map(id),
};
const I = {
  iZ1: id('a1'), // assignee senior
  iZ2: id('a2'),
  iAz: id('a3'), // outside the manager portfolio
  iB: id('a4'),
  iCap: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map(id),
};

// Seeded system reference type (supabase/seed.sql): 'Income Tax Return'.
const SYS_ITR = '50000000-0000-4000-8000-000000000005';

const ORDINAL = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];

// The staff branch INNER JOINs profiles — the harness seed creates auth
// users only, so the suite owns these profile rows (upsert + scoped delete).
// 'Zephyr Partner' exists in BOTH firms on purpose (cross-firm name collision).
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

/** The RPC proof path: a signed-in token + the untrusted selector, raw
 *  PostgREST against the SECURITY INVOKER function. */
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

/** The adapter proof path: an authenticated session + the selector, then
 *  the REAL searchService composition. */
async function serviceSearchAs(userKey: string, firm: string, query: string): Promise<StructuredSearchHit[]> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: userEmail(userKey),
    password: PASSWORD,
  });
  expect(error).toBeNull();
  setActiveFirm(firm);
  return searchService.searchStructured(query);
}

const seqOf = (rows: Array<{ kind: string; id: string }>) => rows.map((r) => `${r.kind}:${r.id}`);

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

/** Profile rows are global (no firm_id); their audit rows land with
 *  firm_id NULL and object_type 'profile'. Sweep scoped to exactly the
 *  user ids this suite touched. */
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

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run left a membership mid-flight.
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

    -- NOTE: the Captest registration values deliberately start with
    -- 'Captest' — the registration branch matches registrations.value ONLY
    -- (exact or case-sensitive prefix), so 'ZephyrC00xZ' values could never
    -- exercise the per-kind cap for a 'Captest' query.
    insert into public.registrations (id, firm_id, legal_entity_id, type, value, state) values
      ('${R.rZ1}', '${FSA}', '${E.eZ1}', 'PAN', 'Zephyr1234F', null),
      ('${R.rZ2}', '${FSA}', '${E.eZ2}', 'PAN', 'Zephyr5678K', null),
      ('${R.rB}',  '${FSB}', '${E.eB}',  'PAN', 'Zephyr1234F', null),
      ${ORDINAL.map((_, i) => `('${R.rCap[i]}', '${FSA}', '${E.eCap[i]}', 'GSTIN', 'CaptestC00${i + 1}Z', 'MH')`).join(',\n      ')};

    -- Instance fixtures are plain operator INSERTs: client_id is
    -- trigger-derived from the legal entity (SCH-A-02), and the state guard
    -- binds UPDATE only (the deadline-readmodel fixture precedent).
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

    -- Task fixtures are plain operator INSERTs (status is unguarded on
    -- INSERT — DM-SM-05 transition legality is command-owned; the
    -- deadline-readmodel/mywork fixture precedent).
    insert into public.tasks (id, firm_id, client_id, title, next_action, assignee_membership_id) values
      ('${T.tZ1}', '${FSA}', '${C.cZ1}', 'Zephyr GSTR-1 reconciliation', 'reconcile', '${M.sA}'),
      ('${T.tZ2}', '${FSA}', '${C.cZ1}', 'Zephyr payroll prep',          'prepare',   null),
      ('${T.tAz}', '${FSA}', '${C.cAz}', 'Zephyr audit followup',        'follow up', null),
      ('${T.tB}',  '${FSB}', '${C.cB}',  'Zephyr Bazar filing',          'file',      null),
      ${ORDINAL.map((n, i) => `('${T.tCap[i]}', '${FSA}', '${C.cCap[i]}', 'Captest task ${n}', 'x', null)`).join(',\n      ')};
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // the tables stay clean for other suites (IMP-031/040/041/042/051
  // precedent), scoped to THIS suite's firms and profile ids only.
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
    -- The firm/profile DELETEs themselves land Layer-A audit rows; sweep last.
    delete from public.audit_log where firm_id in (${FIRM_LIST});
    delete from public.event_outbox where firm_id in (${FIRM_LIST});
  `);
  cleanProfileNoise();
});

describe('TEST-API-21 — API-R0-SRC structured-search contract', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(searchService.mode).toBe('supabase');
  });

  it('catalog posture: one SECURITY INVOKER STABLE function, pinned search_path, p_query only, authenticated-only EXECUTE, no pg_trgm, one migration file', () => {
    const count = psql(
      `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'structured_search'`,
    ).trim();
    expect(count).toBe('1');

    const meta = psql(
      `select p.prosecdef, p.provolatile, array_to_string(p.proconfig, ','),
              pg_get_function_identity_arguments(p.oid)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'structured_search'`,
    ).trim();
    // SECURITY INVOKER (prosecdef = f), STABLE, search_path pinned to '',
    // identity arguments EXACTLY 'p_query text' — no firm_id (API-CONV-05).
    expect(meta).toBe('f|s|search_path=""|p_query text');

    const priv = psql(
      `select has_function_privilege('authenticated', 'public.structured_search(text)', 'EXECUTE'),
              has_function_privilege('anon',          'public.structured_search(text)', 'EXECUTE'),
              has_function_privilege('service_role',  'public.structured_search(text)', 'EXECUTE'),
              has_function_privilege('public',        'public.structured_search(text)', 'EXECUTE')`,
    ).trim();
    expect(priv).toBe('t|f|f|f');

    const trgm = psql(`select count(*) from pg_extension where extname = 'pg_trgm'`).trim();
    expect(trgm).toBe('0');

    const migrationFiles = readdirSync(new URL('../../../supabase/migrations', import.meta.url)).filter((f) =>
      f.includes('structured_search'),
    );
    expect(migrationFiles).toEqual(['20260920000000_structured_search.sql']);
  });

  it('partner query returns hits of ALL SIX kinds, each row carrying exactly the contract keys', async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    const kinds = [...new Set(rows.map((r) => r.kind))].sort();
    expect(kinds).toEqual([
      'client',
      'compliance_instance',
      'legal_entity',
      'registration',
      'staff',
      'task',
    ]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['href', 'id', 'kind', 'label', 'match_class', 'status', 'sub']);
    }
  });

  it('href matrix (R11-A): client/entity/registration navigate to /clients/<clientId>; task/instance/staff are non-navigable', async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    const byId = (rowId: string): SearchRow => {
      const row = rows.find((r) => r.id === rowId);
      expect(row, `hit ${rowId}`).toBeDefined();
      return row as SearchRow;
    };
    expect(byId(C.cZ1)).toMatchObject({ kind: 'client', href: `/clients/${C.cZ1}` });
    expect(byId(E.eZ1)).toMatchObject({ kind: 'legal_entity', href: `/clients/${C.cZ1}` });
    expect(byId(R.rZ1)).toMatchObject({ kind: 'registration', href: `/clients/${C.cZ1}` });
    expect(byId(T.tZ1)).toMatchObject({ kind: 'task', href: null });
    expect(byId(I.iZ1)).toMatchObject({ kind: 'compliance_instance', href: null });
    expect(byId(M.pA)).toMatchObject({ kind: 'staff', href: null });
    // The matrix holds for EVERY returned row, not just the samples.
    for (const row of rows) {
      if (row.kind === 'client' || row.kind === 'legal_entity' || row.kind === 'registration') {
        expect(row.href).toMatch(/^\/clients\/[0-9a-f-]{36}$/);
      } else {
        expect(row.href).toBeNull();
      }
    }
  });

  it('masking (R7): registration label is type + last four; the raw identifier appears NOWHERE in the payload', async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    const hit = rows.find((r) => r.id === R.rZ1);
    expect(hit).toBeDefined();
    expect(hit?.label).toBe('PAN ····234F');
    expect(hit?.sub).toBe('Zephyr Holdings Pvt Ltd · Zephyr Textiles');
    expect(JSON.stringify(rows)).not.toContain('Zephyr1234F');
    expect(JSON.stringify(rows)).not.toContain('Zephyr5678K');
  });

  it('offboarded clients stay searchable with a truthful status (R10)', async () => {
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Offboarded');
    const client = rows.find((r) => r.id === C.cOff);
    expect(client).toBeDefined();
    expect(client?.kind).toBe('client');
    expect(client?.status).toBe('offboarded');
    // The offboarded entity chain remains reachable too.
    expect(rows.some((r) => r.id === E.eOff && r.kind === 'legal_entity')).toBe(true);
  });

  it('caps (R5): 5 per kind and 20 global, enforced server-side with canonical ordering', async () => {
    // 6 matching rows exist per kind (clients/entities/registrations/tasks/
    // instances) = 30 candidates; per-kind caps shape 5+5+5+5+5 = 25 and the
    // global cap keeps exactly 20.
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Captest');
    expect(rows).toHaveLength(20);
    for (const row of rows) expect(row.match_class).toBe('prefix');

    const countOf = (kind: string) => rows.filter((r) => r.kind === kind).length;
    expect(countOf('client')).toBe(5);
    expect(countOf('legal_entity')).toBe(5);
    expect(countOf('registration')).toBe(5);
    expect(countOf('task')).toBe(5);
    // The sixth kind is cut entirely by the GLOBAL limit (kind rank).
    expect(countOf('compliance_instance')).toBe(0);

    // Canonical order: kind rank (client → legal_entity → registration →
    // task) with ids ascending within kind; the 6th (highest-id) row of
    // each kind is the one dropped by the per-kind cap.
    expect(seqOf(rows)).toEqual([
      ...C.cCap.slice(0, 5).map((i) => `client:${i}`),
      ...E.eCap.slice(0, 5).map((i) => `legal_entity:${i}`),
      ...R.rCap.slice(0, 5).map((i) => `registration:${i}`),
      ...T.tCap.slice(0, 5).map((i) => `task:${i}`),
    ]);
  });

  it('deterministic ordering: two identical calls return identical kind:id sequences', async () => {
    const first = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    const second = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    expect(seqOf(second)).toEqual(seqOf(first));
    expect(second).toEqual(first);
  });

  it('truthful empty (API-ERR-02): an unmatched query is 200 with an empty array, never an error', async () => {
    const token = await tokenFor('USER_A_PARTNER');
    const res = await api(token, 'POST', 'rpc/structured_search', {
      headers: H(FSA),
      body: { p_query: 'zz-no-such-thing' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('the REAL searchService adapter returns the same hits with camelCase DTO keys and the same R11-A destinations', async () => {
    const hits = await serviceSearchAs('USER_A_PARTNER', FSA, 'Zephyr');
    const rows = await rpcSearch('USER_A_PARTNER', FSA, 'Zephyr');
    expect(seqOf(hits)).toEqual(seqOf(rows));

    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual(['href', 'id', 'kind', 'label', 'matchClass', 'status', 'sub']);
    }
    const byId = (hitId: string): StructuredSearchHit => {
      const hit = hits.find((h) => h.id === hitId);
      expect(hit, `adapter hit ${hitId}`).toBeDefined();
      return hit as StructuredSearchHit;
    };
    expect(byId(C.cZ1).href).toBe(`/clients/${C.cZ1}`);
    expect(byId(E.eZ1).href).toBe(`/clients/${C.cZ1}`);
    expect(byId(R.rZ1).href).toBe(`/clients/${C.cZ1}`);
    expect(byId(R.rZ1).label).toBe('PAN ····234F');
    expect(byId(T.tZ1).href).toBeNull();
    expect(byId(I.iZ1).href).toBeNull();
    expect(byId(M.pA).href).toBeNull();
    expect(JSON.stringify(hits)).not.toContain('Zephyr1234F');

    // R4 client-side guard: sub-minimum queries never issue a live request.
    expect(await searchService.searchStructured('z')).toEqual([]);
    expect(await searchService.searchStructured('  ')).toEqual([]);

    // Truthful empty through the adapter too.
    expect(await searchService.searchStructured('zz-no-such-thing')).toEqual([]);
  });
});
