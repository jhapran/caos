/**
 * IMP-042 — My Work Supabase adapter personal-scope integration tests
 * (TEST-API-19, API-R0-MWK, DEC-L, DEC-J, RLS-CTX-02, DM-X-02, API-ERR-02).
 *
 * Drives the REAL myworkService Supabase adapter composition against the
 * live local stack through authenticated password-grant sessions
 * (getSupabaseClient().auth) + setActiveFirm() — exactly as application
 * code does. NO privileged SQL is a proof mechanism: psql (operator) is
 * used only for fixture seed/teardown, the controlled membership
 * suspension in the DEC-J freshness case, and nothing else.
 *
 * Proves, per role, through getMyWork() only:
 *   - DEC-L personal scope: every staff role (super_admin, partner,
 *     manager, senior, article) sees ONLY its own assigned/actionable
 *     items — exact item-id sets per bucket; another member's task never
 *     appears, even for the firm-wide-read roles (super_admin/partner);
 *   - the four buckets: Today (overdue-inclusive), This Week, Waiting
 *     (waiting_reason rides along; Waiting precedence over date buckets),
 *     Returned; terminal (done) and beyond-this-week items never surface;
 *   - returned canonicalization (DEC-L): a task-linked returned ReviewItem
 *     (task assignee X = manager, submitter Y = senior) surfaces EXACTLY
 *     ONCE as the canonical TASK item, only in the task owner's buckets —
 *     the ReviewItem is never additionally surfaced, not even to its own
 *     submitter; a standalone returned ReviewItem surfaces ONLY to its
 *     submitter with nextAction exactly STANDALONE_RETURNED_NEXT_ACTION
 *     ('Address reviewer feedback'); another user's standalone returned
 *     work never leaks, including to super_admin/partner firm-wide reads;
 *   - billing receives the empty contract (all four buckets empty, no
 *     error — API-ERR-02 collection semantics);
 *   - cross-firm isolation both directions, and a caller with no live
 *     membership in the selected firm gets the empty contract (the
 *     selector is untrusted context, RLS-CTX-02);
 *   - DEC-J live-membership freshness: suspending the membership empties
 *     the caller's next getMyWork() (privileged setup), restore for
 *     teardown;
 *   - client display references resolve under the caller's OWN RLS:
 *     manager+/portfolio roles get the client name, senior/article (no R0
 *     client read) get null — never an error.
 *
 * Date rules: the This Week window (businessDate < due <= ISO week end) is
 * EMPTY when the business date is a Sunday, so the two "week" fixtures and
 * their expected buckets are computed from the REAL Asia/Kolkata business
 * date at run time (the suite stays exact on any weekday).
 *
 * Re-runnable: dedicated fixture firms in the 6f000000-… range (isolated
 * from the shared registry firms other suites clean), deterministic ids,
 * force-reset on every run; fixture audit rows removed as the operator,
 * scoped to THESE two firm ids only (AUD-INV-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearActiveFirm, setActiveFirm } from '@/data/context';
import {
  isoWeekEndDate,
  kolkataBusinessDate,
  myworkService,
  STANDALONE_RETURNED_NEXT_ACTION,
  type MyWorkBuckets,
} from '@/data/mywork';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

// This suite owns TWO dedicated firms — never the shared registry FIRM_A/B.
const FIRM_M = '6f000000-0000-4000-8000-00000000f00a';
const FIRM_N = '6f000000-0000-4000-8000-00000000f00b';

const M = {
  superM: '6f000000-0000-4000-8000-000000000001',
  partnerM: '6f000000-0000-4000-8000-000000000002',
  managerM: '6f000000-0000-4000-8000-000000000003',
  seniorM: '6f000000-0000-4000-8000-000000000004',
  articleM: '6f000000-0000-4000-8000-000000000005',
  billingM: '6f000000-0000-4000-8000-000000000006',
  partnerN: '6f000000-0000-4000-8000-000000000007', // FIRM_N partner
  seniorN: '6f000000-0000-4000-8000-000000000008', // FIRM_N senior
};
const C = {
  main: '6f000000-0000-4000-8000-000000000101', // FIRM_M working client
  nobody: '6f000000-0000-4000-8000-000000000102', // FIRM_M — tasks belong to nobody relevant
  mirror: '6f000000-0000-4000-8000-000000000111', // FIRM_N client
};
const T = {
  superToday: '6f000000-0000-4000-8000-000000000301', // overdue → Today (super)
  superDone: '6f000000-0000-4000-8000-000000000302', // terminal — never surfaced
  partnerWeek: '6f000000-0000-4000-8000-000000000303', // → This Week (Today on a Sunday)
  managerWait: '6f000000-0000-4000-8000-000000000304', // waiting + reason, overdue → Waiting precedence
  linkedReturned: '6f000000-0000-4000-8000-000000000305', // returned, claimed by RI.linked → Returned (manager)
  articleReviewed: '6f000000-0000-4000-8000-000000000306', // assignee article, REVIEWER manager → both
  seniorToday: '6f000000-0000-4000-8000-000000000307', // due today → Today (senior)
  seniorFar: '6f000000-0000-4000-8000-000000000308', // beyond this ISO week — never surfaced
  articleWeek: '6f000000-0000-4000-8000-000000000309', // → This Week (Today on a Sunday)
  nobodyTask: '6f000000-0000-4000-8000-00000000030a', // C.nobody, unassigned — never surfaced
  mirror: '6f000000-0000-4000-8000-000000000311', // FIRM_N mirror task (seniorN)
};
const RI = {
  linked: '6f000000-0000-4000-8000-000000000401', // task-linked returned; submitter senior (Y) ≠ assignee manager (X)
  standalone: '6f000000-0000-4000-8000-000000000402', // standalone returned, submitted by article
  seniorOwn: '6f000000-0000-4000-8000-000000000403', // standalone returned, submitted by senior
};

// DEC-L business dates (Asia/Kolkata) at run time — see the header note.
const shift = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const TODAY = kolkataBusinessDate();
const WEEK_END = isoWeekEndDate(TODAY);
// The This Week window (TODAY, WEEK_END] is degenerate when TODAY is the
// Sunday week-end itself; the "week" fixtures then land in Today instead.
const HAS_WEEK_WINDOW = WEEK_END > TODAY;
const WEEK_DUE = HAS_WEEK_WINDOW ? WEEK_END : TODAY;
const WEEK_BUCKET: 'thisWeek' | 'today' = HAS_WEEK_WINDOW ? 'thisWeek' : 'today';
const YESTERDAY = shift(TODAY, -1);
const FAR = shift(WEEK_END, 7);

const EMPTY: MyWorkBuckets = { today: [], thisWeek: [], waiting: [], returned: [] };

async function signInAs(email: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password: PASSWORD });
  expect(error).toBeNull();
}

/** The proof path: an authenticated session + the selector, then the REAL
 *  adapter composition. Nothing privileged. */
async function myWork(userKey: string, firm: string): Promise<MyWorkBuckets> {
  await signInAs(userEmail(userKey));
  setActiveFirm(firm);
  return myworkService.getMyWork();
}

const ids = (items: Array<{ id: string }>) => items.map((i) => i.id).sort();
const allIds = (b: MyWorkBuckets) =>
  [...b.today, ...b.thisWeek, ...b.waiting, ...b.returned].map((i) => i.id);

function cleanRows() {
  psql(`
    delete from public.audit_log where firm_id in ('${FIRM_M}', '${FIRM_N}');
    delete from public.review_items where firm_id in ('${FIRM_M}', '${FIRM_N}');
    delete from public.tasks where firm_id in ('${FIRM_M}', '${FIRM_N}');
    delete from public.clients where firm_id in ('${FIRM_M}', '${FIRM_N}');
    delete from public.firm_memberships where firm_id in ('${FIRM_M}', '${FIRM_N}');
  `);
}

beforeAll(() => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_M}', 'IMP-042 MWK Firm Main'),
      ('${FIRM_N}', 'IMP-042 MWK Firm Other')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superM}',   '${FIRM_M}', '${userId('USER_A_SUPER_ADMIN')}', 'super_admin',       'active'),
      ('${M.partnerM}', '${FIRM_M}', '${userId('USER_A_PARTNER')}',     'partner',           'active'),
      ('${M.managerM}', '${FIRM_M}', '${userId('USER_A_MANAGER')}',     'manager',           'active'),
      ('${M.seniorM}',  '${FIRM_M}', '${userId('USER_A_SENIOR')}',      'senior',            'active'),
      ('${M.articleM}', '${FIRM_M}', '${userId('USER_A_ARTICLE')}',     'article_executive', 'active'),
      ('${M.billingM}', '${FIRM_M}', '${userId('USER_A_BILLING')}',     'billing',           'active'),
      ('${M.partnerN}', '${FIRM_N}', '${userId('USER_B_PARTNER')}',     'partner',           'active'),
      ('${M.seniorN}',  '${FIRM_N}', '${userId('USER_B_SENIOR')}',      'senior',            'active')
    on conflict (firm_id, user_id) do nothing;

    -- Force-reset mutable state so re-runs are deterministic even if a
    -- previous run left the DEC-J freshness case mid-flight.
    update public.firm_memberships set status = 'active'
      where id in ('${M.superM}', '${M.partnerM}', '${M.managerM}', '${M.seniorM}', '${M.articleM}',
                   '${M.billingM}', '${M.partnerN}', '${M.seniorN}');

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.main}',   '${FIRM_M}', 'MWK Client Main',   '${M.partnerM}', '${M.managerM}', 'active'),
      ('${C.nobody}', '${FIRM_M}', 'MWK Client Nobody', '${M.partnerM}', null,            'active'),
      ('${C.mirror}', '${FIRM_N}', 'MWK Client Mirror', '${M.partnerN}', null,            'active');

    -- Task fixtures are plain operator INSERTs (status is unguarded on
    -- INSERT — DM-SM-05 transition legality is command-owned, and the
    -- waiting-reason invariant is deliberately not a CHECK).
    insert into public.tasks
      (id, firm_id, client_id, title, next_action, status, waiting_reason, due_date,
       assignee_membership_id, reviewer_membership_id)
    values
      ('${T.superToday}',     '${FIRM_M}', '${C.main}',   'MWK super today',      'file the return',          'open',     null,                         '${YESTERDAY}', '${M.superM}',   null),
      ('${T.superDone}',      '${FIRM_M}', '${C.main}',   'MWK super done',       'file the return',          'done',     null,                         '${YESTERDAY}', '${M.superM}',   null),
      ('${T.partnerWeek}',    '${FIRM_M}', '${C.main}',   'MWK partner week',     'review the draft',         'open',     null,                         '${WEEK_DUE}',  '${M.partnerM}', null),
      ('${T.managerWait}',    '${FIRM_M}', '${C.main}',   'MWK manager waiting',  'chase client documents',   'waiting',  'client documents pending',   '${YESTERDAY}', '${M.managerM}', null),
      ('${T.linkedReturned}', '${FIRM_M}', '${C.main}',   'MWK linked returned',  'redo the reconciliation',  'returned', null,                         '${YESTERDAY}', '${M.managerM}', null),
      ('${T.articleReviewed}','${FIRM_M}', '${C.main}',   'MWK article reviewed', 'prepare the workpaper',    'open',     null,                         '${YESTERDAY}', '${M.articleM}', '${M.managerM}'),
      ('${T.seniorToday}',    '${FIRM_M}', '${C.main}',   'MWK senior today',     'complete the checklist',   'open',     null,                         '${TODAY}',     '${M.seniorM}',  null),
      ('${T.seniorFar}',      '${FIRM_M}', '${C.main}',   'MWK senior far',       'future prep',              'open',     null,                         '${FAR}',       '${M.seniorM}',  null),
      ('${T.articleWeek}',    '${FIRM_M}', '${C.main}',   'MWK article week',     'draft the annexures',      'open',     null,                         '${WEEK_DUE}',  '${M.articleM}', null),
      ('${T.nobodyTask}',     '${FIRM_M}', '${C.nobody}', 'MWK unassigned',       'collect docs',             'open',     null,                         '${YESTERDAY}', null,            null),
      ('${T.mirror}',         '${FIRM_N}', '${C.mirror}', 'MWK mirror task',      'mirror prep',              'open',     null,                         '${YESTERDAY}', '${M.seniorN}',  null);

    -- Returned ReviewItems (operator INSERTs; the status/decision guard
    -- binds UPDATE only). The DM-SM-06 decision CHECK requires decider +
    -- timestamp + non-empty rationale, decider ≠ submitter.
    insert into public.review_items
      (id, firm_id, client_id, task_id, type, title, status,
       submitted_by_membership_id, decided_by_membership_id, decided_at, decision_rationale)
    values
      ('${RI.linked}',     '${FIRM_M}', '${C.main}', '${T.linkedReturned}', 'gst_reconciliation', 'MWK linked returned item', 'returned',
       '${M.seniorM}',  '${M.partnerM}', '2026-09-05T10:00:00+00:00', 'Please rework the reconciliation'),
      ('${RI.standalone}', '${FIRM_M}', '${C.main}', null,                  'tds_return',         'MWK standalone returned',  'returned',
       '${M.articleM}', '${M.partnerM}', '2026-09-05T10:00:00+00:00', 'Fix the TDS mapping'),
      ('${RI.seniorOwn}',  '${FIRM_M}', '${C.main}', null,                  'itr_computation',    'MWK senior standalone',    'returned',
       '${M.seniorM}',  '${M.managerM}', '2026-09-05T10:00:00+00:00', 'Recompute the MAT credit');
  `);
  // Fixture writes are operator/system-actor rows; remove fixture noise so
  // the table stays clean for other suites (IMP-031/040/041 precedent).
  psql(`delete from public.audit_log where firm_id in ('${FIRM_M}', '${FIRM_N}')`);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firms where id in ('${FIRM_M}', '${FIRM_N}')
      and not exists (select 1 from public.firm_memberships m where m.firm_id = firms.id)
      and not exists (select 1 from public.clients c where c.firm_id = firms.id);
  `);
});

// ---------------------------------------------------------------------------
// TEST-API-19 — DEC-L personal scope per role (exact item-id sets)
// ---------------------------------------------------------------------------

describe('TEST-API-19 — My Work personal scope (DEC-L) — supabase adapter, live stack', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(myworkService.mode).toBe('supabase');
  });

  it('super_admin sees ONLY their own work — firm-wide read power surfaces nobody else’s tasks', async () => {
    const b = await myWork('USER_A_SUPER_ADMIN', FIRM_M);
    expect(ids(b.today)).toEqual([T.superToday]);
    expect(b.thisWeek).toEqual([]);
    expect(b.waiting).toEqual([]);
    expect(b.returned).toEqual([]);
    // Terminal and unassigned items never surface; nobody else's task does.
    expect(allIds(b)).not.toContain(T.superDone);
    expect(allIds(b)).not.toContain(T.nobodyTask);
    // The client display reference resolves under the caller's own RLS.
    expect(b.today[0].clientName).toBe('MWK Client Main');
    expect(b.today[0].kind).toBe('task');
    expect(b.today[0].nextAction).toBe('file the return');
  });

  it('partner sees only their own due-this-week item', async () => {
    const b = await myWork('USER_A_PARTNER', FIRM_M);
    expect(ids(b[WEEK_BUCKET])).toEqual([T.partnerWeek]);
    expect(ids(b[WEEK_BUCKET === 'today' ? 'thisWeek' : 'today'])).toEqual([]);
    expect(b.waiting).toEqual([]);
    expect(b.returned).toEqual([]);
  });

  it('manager: reviewer-owned task counts as own (Today); Waiting carries its reason and beats the date buckets', async () => {
    const b = await myWork('USER_A_MANAGER', FIRM_M);
    // T.articleReviewed is the article's task — surfaced to the manager
    // ONLY because the manager is its assigned reviewer (DEC-L own-work
    // includes reviewer responsibility).
    expect(ids(b.today)).toEqual([T.articleReviewed]);
    expect(b.thisWeek).toEqual([]);
    expect(ids(b.waiting)).toEqual([T.managerWait]);
    expect(b.waiting[0].waitingReason).toBe('client documents pending');
    expect(b.waiting[0].nextAction).toBe('chase client documents');
    expect(b.waiting[0].clientName).toBe('MWK Client Main'); // portfolio manager
  });

  it('senior sees only their own Today item; beyond-this-week work never surfaces; client name is null under senior RLS', async () => {
    const b = await myWork('USER_A_SENIOR', FIRM_M);
    expect(ids(b.today)).toEqual([T.seniorToday]);
    expect(b.thisWeek).toEqual([]);
    expect(b.waiting).toEqual([]);
    expect(ids(b.returned)).toEqual([RI.seniorOwn]);
    expect(allIds(b)).not.toContain(T.seniorFar);
    // Senior/article have NO client read in R0 (IMP-020): the display
    // reference renders null, never fails the read.
    expect(b.today[0].clientName).toBeNull();
    expect(b.returned[0].clientName).toBeNull();
  });

  it('article sees their own tasks plus their standalone returned item with the exact contract nextAction', async () => {
    const b = await myWork('USER_A_ARTICLE', FIRM_M);
    const expectedToday = WEEK_BUCKET === 'today' ? [T.articleReviewed, T.articleWeek] : [T.articleReviewed];
    const expectedWeek = WEEK_BUCKET === 'thisWeek' ? [T.articleWeek] : [];
    expect(ids(b.today)).toEqual(expectedToday.sort());
    expect(ids(b.thisWeek)).toEqual(expectedWeek);
    expect(b.waiting).toEqual([]);
    expect(ids(b.returned)).toEqual([RI.standalone]);

    const item = b.returned[0];
    expect(item.kind).toBe('returned_review');
    expect(item.status).toBe('returned');
    expect(item.returned).toBe(true);
    expect(item.taskId).toBeNull();
    expect(item.reviewItemId).toBe(RI.standalone);
    expect(item.dueDate).toBeNull();
    expect(item.nextAction).toBe('Address reviewer feedback');
    expect(item.nextAction).toBe(STANDALONE_RETURNED_NEXT_ACTION);
    // Another user's standalone returned work never leaks (RI.seniorOwn is
    // the senior's).
    expect(allIds(b)).not.toContain(RI.seniorOwn);
    // Another member's task never appears.
    expect(allIds(b)).not.toContain(T.seniorToday);
    expect(allIds(b)).not.toContain(T.managerWait);
  });

  it('billing receives the empty contract — all four buckets empty, no error (API-ERR-02 collection semantics)', async () => {
    const b = await myWork('USER_A_BILLING', FIRM_M);
    expect(b).toEqual(EMPTY);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-19 / DEC-L — returned canonicalization across callers
// ---------------------------------------------------------------------------

describe('TEST-API-19 — task-linked returned canonicalizes to the TASK, exactly once, only for the task owner (DEC-L)', () => {
  it('the manager (task assignee X) gets the canonical task item in Returned; the linked ReviewItem never surfaces as itself', async () => {
    const b = await myWork('USER_A_MANAGER', FIRM_M);
    expect(ids(b.returned)).toEqual([T.linkedReturned]);
    const item = b.returned[0];
    expect(item.kind).toBe('task');
    expect(item.id).toBe(T.linkedReturned);
    expect(item.taskId).toBe(T.linkedReturned);
    expect(item.reviewItemId).toBe(RI.linked); // traceability to the claiming item
    expect(item.returned).toBe(true);
    // DEC-L: the task's STORED next_action — never the reviewer rationale.
    expect(item.nextAction).toBe('redo the reconciliation');
    // Returned precedence: the task is overdue, yet lands ONLY in Returned.
    expect(allIds(b).filter((id) => id === T.linkedReturned)).toHaveLength(1);
    expect(allIds(b)).not.toContain(RI.linked);
  });

  it('the senior (ReviewItem submitter Y) gets NOTHING from the task-linked return — no duplicate, no leak', async () => {
    const b = await myWork('USER_A_SENIOR', FIRM_M);
    expect(allIds(b)).not.toContain(RI.linked);
    expect(allIds(b)).not.toContain(T.linkedReturned); // the manager's task
  });

  it('super_admin/partner firm-wide reads surface neither the linked item nor another member’s canonical task', async () => {
    for (const key of ['USER_A_SUPER_ADMIN', 'USER_A_PARTNER']) {
      const b = await myWork(key, FIRM_M);
      expect(allIds(b), key).not.toContain(RI.linked);
      expect(allIds(b), key).not.toContain(T.linkedReturned);
      expect(allIds(b), key).not.toContain(RI.standalone);
      expect(allIds(b), key).not.toContain(RI.seniorOwn);
      expect(b.returned, key).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-API-19 — cross-firm isolation (RLS-CTX-02: the selector grants nothing)
// ---------------------------------------------------------------------------

describe('TEST-API-19 — cross-firm isolation, both directions', () => {
  it('FIRM_N members see only their own firm’s work; FIRM_M work never crosses', async () => {
    const seniorN = await myWork('USER_B_SENIOR', FIRM_N);
    expect(ids(seniorN.today)).toEqual([T.mirror]);
    expect(seniorN.thisWeek).toEqual([]);
    expect(seniorN.waiting).toEqual([]);
    expect(seniorN.returned).toEqual([]);

    const partnerN = await myWork('USER_B_PARTNER', FIRM_N);
    expect(partnerN).toEqual(EMPTY); // no FIRM_N work is theirs
  });

  it('selecting a firm without a live membership there yields the empty contract (untrusted selector)', async () => {
    // FIRM_M senior selecting FIRM_N — no membership there.
    expect(await myWork('USER_A_SENIOR', FIRM_N)).toEqual(EMPTY);
    // FIRM_N senior selecting FIRM_M — the mirror task never crosses over.
    expect(await myWork('USER_B_SENIOR', FIRM_M)).toEqual(EMPTY);
  });
});

// ---------------------------------------------------------------------------
// TEST-API-19 / DEC-J — live-membership freshness
// ---------------------------------------------------------------------------

describe('TEST-API-19 — DEC-J live-membership freshness', () => {
  it('suspending the membership empties My Work on the very next call; restoring recovers it', async () => {
    await signInAs(userEmail('USER_A_SENIOR'));
    setActiveFirm(FIRM_M);
    const before = await myworkService.getMyWork();
    expect(allIds(before).length).toBeGreaterThan(0);

    psql(`update public.firm_memberships set status = 'suspended' where id = '${M.seniorM}';`);
    try {
      expect(await myworkService.getMyWork()).toEqual(EMPTY);
    } finally {
      psql(`update public.firm_memberships set status = 'active' where id = '${M.seniorM}';`);
    }
    const restored = await myworkService.getMyWork();
    expect(ids(restored.today)).toEqual([T.seniorToday]);
    expect(ids(restored.returned)).toEqual([RI.seniorOwn]);
  });
});
