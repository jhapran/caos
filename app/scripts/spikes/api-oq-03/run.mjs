/**
 * IMP-060 / API-OQ-03 LOCAL measurement spike — orchestrator.
 *
 * Measures, on the LOCAL Supabase stack ONLY, the two candidate API-R0-DASH
 * architectures with IDENTICAL authorization semantics:
 *
 *   CANDIDATE A — one composite aggregate RPC
 *     (public.api_oq_03_bench_dashboard, SECURITY INVOKER, created by
 *     setup.sql, dropped by teardown.sql; 1 browser round trip).
 *
 *   CANDIDATE B — per-section RLS-respecting reads composed client-side
 *     behind the @/data contract shape (tasks / compliance_instances /
 *     deadline_board / review_items / alerts), in two variants:
 *       fetch  — minimal-column paged scans (PostgREST max_rows=1000),
 *                counted client-side; 5 parallel sections.
 *       counts — per-state count=exact queries (limit=0) + one deadline
 *                board read + snoozed-alert fetch for the derivation.
 *
 * Measured calls always execute as the REAL application path: signed-in
 * harness user token + x-active-firm header + RLS enforced. Superuser psql
 * is used ONLY for fixture generation, ground-truth computation, and
 * EXPLAIN capture — never for a measured call.
 *
 * This runner NEVER selects an architecture. It emits factual evidence
 * (p50/p95 per candidate/role, round trips, plans, gate results) and leaves
 * API-OQ-03 OPEN for the human. There is no normative threshold.
 *
 * Usage (from app/):
 *   node scripts/spikes/api-oq-03/run.mjs [--runs=N>=50] [--keep]
 *                                         [--b-variant=both|fetch|counts]
 * Prerequisites: npm run db:start && npm run db:reset:harness
 * Cleanup: automatic (unless --keep); standalone: node .../teardown.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  CANDIDATE_A_FN,
  FIRM_A,
  FIRM_B,
  MEM,
  api,
  assertLocalSafety,
  decodeJwt,
  localEnv,
  parseExactCountTotal,
  psql,
  psqlFile,
  signIn,
  stats,
  userEmail,
} from './lib.mjs';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
if (args.help) {
  console.log('node scripts/spikes/api-oq-03/run.mjs [--runs=N>=50] [--keep] [--b-variant=both|fetch|counts]');
  process.exit(0);
}
const RUNS = Math.max(50, Number(args.runs ?? 60));
const WARMUP = 10;
const KEEP = Boolean(args.keep);
const B_VARIANTS = args['b-variant'] === 'fetch' ? ['fetch'] : args['b-variant'] === 'counts' ? ['counts'] : ['fetch', 'counts'];

const SETUP_SQL = 'scripts/spikes/api-oq-03/setup.sql';
const TEARDOWN_SQL = 'scripts/spikes/api-oq-03/teardown.sql';
const RESULTS_DIR = 'scripts/spikes/api-oq-03/results';

const TASK_STATES = ['open', 'in_progress', 'waiting', 'submitted', 'returned', 'approved', 'done', 'cancelled'];
const INSTANCE_STATES = [
  'not_started', 'information_requested', 'information_received', 'preparation',
  'internal_review', 'client_approval', 'ready_to_file', 'filed',
  'acknowledgement_received', 'closed',
];

const ROLE_CASES = [
  { key: 'PARTNER_A', user: 'USER_A_PARTNER', firm: FIRM_A },
  { key: 'MANAGER_A', user: 'USER_A_MANAGER', firm: FIRM_A },
  { key: 'SENIOR_A', user: 'USER_A_SENIOR', firm: FIRM_A },
  { key: 'BILLING_A', user: 'USER_A_BILLING', firm: FIRM_A },
];

const results = {
  meta: { date: new Date().toISOString(), runs: RUNS, warmup: WARMUP, bVariants: B_VARIANTS },
  dataset: {},
  gates: [],
  groundTruth: {},
  benchmarks: {},
  plans: {},
  failures: [],
  cleanup: {},
};

function gate(name, expected, observed, pass) {
  results.gates.push({ name, expected, observed, pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}: ${observed}`);
}

// ---------------------------------------------------------------------------
// Canonical counter object (identical shape for A, B and ground truth)
// ---------------------------------------------------------------------------
function zeroCounters() {
  return {
    tasks_by_status: Object.fromEntries(TASK_STATES.map((s) => [s, 0])),
    instances_by_state: Object.fromEntries(INSTANCE_STATES.map((s) => [s, 0])),
    deadline: { groups: 0, at_risk_instances: 0, total_instances: 0 },
    pending_reviews: 0,
    active_alerts: 0,
  };
}

function normalizeCounters(raw) {
  const c = zeroCounters();
  for (const s of TASK_STATES) c.tasks_by_status[s] = Number(raw?.tasks_by_status?.[s] ?? 0);
  for (const s of INSTANCE_STATES) c.instances_by_state[s] = Number(raw?.instances_by_state?.[s] ?? 0);
  c.deadline.groups = Number(raw?.deadline?.groups ?? 0);
  c.deadline.at_risk_instances = Number(raw?.deadline?.at_risk_instances ?? 0);
  c.deadline.total_instances = Number(raw?.deadline?.total_instances ?? 0);
  c.pending_reviews = Number(raw?.pending_reviews ?? 0);
  c.active_alerts = Number(raw?.active_alerts ?? 0);
  return c;
}

const countersEqual = (a, b) => JSON.stringify(normalizeCounters(a)) === JSON.stringify(normalizeCounters(b));

/** TEST-API-18 derivation — identical to src/data/alerts/types.ts. */
function isEffectivelyActive(a, now = Date.now()) {
  if (a.status === 'active') return true;
  if (a.status !== 'snoozed' || a.snoozed_until == null) return false;
  if (new Date(a.snoozed_until).getTime() > now) return false;
  return a.acknowledged_at == null;
}

// ---------------------------------------------------------------------------
// Candidate A — measured call (real application posture)
// ---------------------------------------------------------------------------
async function runCandidateA(session, firm) {
  const t0 = performance.now();
  const r = await api(session.token, 'POST', `rpc/${CANDIDATE_A_FN}`, {
    headers: { 'x-active-firm': firm },
    body: {},
  });
  const ms = performance.now() - t0;
  if (r.status !== 200) throw new Error(`candidate A HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return { ms, roundTrips: 1, payloadBytes: r.bytes, counters: normalizeCounters(r.body) };
}

// ---------------------------------------------------------------------------
// Candidate B — per-section reads composed client-side
// ---------------------------------------------------------------------------
async function fetchAllPages(session, firm, path) {
  let offset = 0;
  let rows = [];
  let trips = 0;
  let bytes = 0;
  for (;;) {
    const r = await api(session.token, 'GET', `${path}&limit=1000&offset=${offset}`, {
      headers: { 'x-active-firm': firm },
    });
    trips += 1;
    bytes += r.bytes;
    if (r.status !== 200) throw new Error(`B fetch ${path} HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    rows = rows.concat(r.body);
    if (r.body.length < 1000) break;
    offset += 1000;
  }
  return { rows, trips, bytes };
}

async function exactCount(session, firm, path) {
  const r = await api(session.token, 'GET', `${path}&limit=0`, {
    headers: { 'x-active-firm': firm, Prefer: 'count=exact' },
  });
  // PostgREST answers count-only (limit=0) exact-count requests with
  // 206 Partial Content + `Content-Range: */<total>`; 200 is equally valid
  // for full-range exact-count responses. Status and header are validated
  // jointly; the count comes ONLY from a numeric Content-Range total.
  try {
    return { count: parseExactCountTotal(r.status, r.contentRange), trips: 1, bytes: r.bytes };
  } catch (e) {
    throw new Error(`B count ${path}: ${e.message}`);
  }
}

async function runCandidateBFetch(session, firm) {
  const sections = {
    tasks: 'tasks?select=status&order=id',
    instances: 'compliance_instances?select=state&order=id',
    deadline: 'deadline_board?select=group_id,at_risk,total_clients&order=group_id',
    reviews: 'review_items?select=status&order=id',
    alerts: 'alerts?select=status,snoozed_until,acknowledged_at&order=id',
  };
  const t0 = performance.now();
  const perSection = {};
  const settled = await Promise.all(
    Object.entries(sections).map(async ([name, path]) => {
      const s0 = performance.now();
      const out = await fetchAllPages(session, firm, path);
      perSection[name] = { ms: +(performance.now() - s0).toFixed(2), trips: out.trips, bytes: out.bytes, rows: out.rows.length };
      return [name, out.rows];
    }),
  );
  const ms = performance.now() - t0;
  const data = Object.fromEntries(settled);
  const c = zeroCounters();
  for (const t of data.tasks) c.tasks_by_status[t.status] += 1;
  for (const i of data.instances) c.instances_by_state[i.state] += 1;
  c.deadline.groups = data.deadline.length;
  c.deadline.at_risk_instances = data.deadline.reduce((a, g) => a + Number(g.at_risk), 0);
  c.deadline.total_instances = data.deadline.reduce((a, g) => a + Number(g.total_clients), 0);
  c.pending_reviews = data.reviews.filter((r) => r.status === 'pending').length;
  c.active_alerts = data.alerts.filter((a) => isEffectivelyActive(a)).length;
  return {
    ms,
    roundTrips: Object.values(perSection).reduce((a, s) => a + s.trips, 0),
    payloadBytes: Object.values(perSection).reduce((a, s) => a + s.bytes, 0),
    perSection,
    counters: c,
  };
}

async function runCandidateBCounts(session, firm) {
  const t0 = performance.now();
  const perSection = {};
  const jobs = [];
  for (const s of TASK_STATES) {
    jobs.push(['task:' + s, () => exactCount(session, firm, `tasks?select=id&status=eq.${s}`)]);
  }
  for (const s of INSTANCE_STATES) {
    jobs.push(['instance:' + s, () => exactCount(session, firm, `compliance_instances?select=id&state=eq.${s}`)]);
  }
  jobs.push(['deadline', () => fetchAllPages(session, firm, 'deadline_board?select=group_id,at_risk,total_clients&order=group_id')]);
  jobs.push(['reviews:pending', () => exactCount(session, firm, 'review_items?select=id&status=eq.pending')]);
  jobs.push(['alerts:active', () => exactCount(session, firm, 'alerts?select=id&status=eq.active')]);
  jobs.push(['alerts:snoozed', () => fetchAllPages(session, firm, 'alerts?select=status,snoozed_until,acknowledged_at&status=eq.snoozed&order=id')]);

  const settled = await Promise.all(
    jobs.map(async ([name, fn]) => {
      const s0 = performance.now();
      const out = await fn();
      perSection[name] = { ms: +(performance.now() - s0).toFixed(2), trips: out.trips, bytes: out.bytes };
      return [name, out];
    }),
  );
  const ms = performance.now() - t0;
  const data = Object.fromEntries(settled);
  const c = zeroCounters();
  for (const s of TASK_STATES) c.tasks_by_status[s] = data['task:' + s].count;
  for (const s of INSTANCE_STATES) c.instances_by_state[s] = data['instance:' + s].count;
  c.deadline.groups = data.deadline.rows.length;
  c.deadline.at_risk_instances = data.deadline.rows.reduce((a, g) => a + Number(g.at_risk), 0);
  c.deadline.total_instances = data.deadline.rows.reduce((a, g) => a + Number(g.total_clients), 0);
  c.pending_reviews = data['reviews:pending'].count;
  c.active_alerts =
    data['alerts:active'].count + data['alerts:snoozed'].rows.filter((a) => isEffectivelyActive(a)).length;
  return {
    ms,
    roundTrips: Object.values(perSection).reduce((a, s) => a + s.trips, 0),
    payloadBytes: Object.values(perSection).reduce((a, s) => a + s.bytes, 0),
    perSection,
    counters: c,
  };
}

// ---------------------------------------------------------------------------
// Ground truth — superuser SQL replicating each role's RLS scoping predicate.
// Used ONLY by the correctness/security gates; never a measured path.
// ---------------------------------------------------------------------------
function gtSql(roleKey) {
  const partner = `'${MEM.partnerA}'`;
  const manager = `'${MEM.managerA}'`;
  const senior = `'${MEM.seniorA}'`;
  const firm = `'${FIRM_A}'`;

  let taskScope, cinScope, revScope, alrScope;
  if (roleKey === 'PARTNER_A') {
    taskScope = cinScope = revScope = alrScope = 'true';
  } else if (roleKey === 'MANAGER_A') {
    taskScope = `(exists (select 1 from public.clients c where c.firm_id = t.firm_id and c.id = t.client_id and c.manager_membership_id = ${manager})
      or ${manager} in (t.assignee_membership_id, t.reviewer_membership_id))`;
    cinScope = `exists (select 1 from public.clients c where c.firm_id = i.firm_id and c.id = i.client_id and c.manager_membership_id = ${manager})`;
    revScope = `(exists (select 1 from public.clients c where c.firm_id = r.firm_id and c.id = r.client_id and c.manager_membership_id = ${manager})
      or exists (select 1 from public.tasks t2 where t2.firm_id = r.firm_id and t2.id = r.task_id and ${manager} in (t2.assignee_membership_id, t2.reviewer_membership_id)))`;
    alrScope = 'true';
  } else if (roleKey === 'SENIOR_A') {
    taskScope = `${senior} in (t.assignee_membership_id, t.reviewer_membership_id)`;
    cinScope = `${senior} in (i.assignee_membership_id, i.reviewer_membership_id)`;
    revScope = `r.submitted_by_membership_id = ${senior}`;
    alrScope = `(
      (a.compliance_instance_id is not null and (
        exists (select 1 from public.compliance_instances i2 where i2.firm_id = a.firm_id and i2.id = a.compliance_instance_id and ${senior} in (i2.assignee_membership_id, i2.reviewer_membership_id))
        or exists (select 1 from public.tasks t3 where t3.firm_id = a.firm_id and t3.compliance_instance_id = a.compliance_instance_id and ${senior} in (t3.assignee_membership_id, t3.reviewer_membership_id))))
      or (a.compliance_instance_id is null and a.client_id is not null and (
        exists (select 1 from public.tasks t4 where t4.firm_id = a.firm_id and t4.client_id = a.client_id and ${senior} in (t4.assignee_membership_id, t4.reviewer_membership_id))
        or exists (select 1 from public.compliance_instances i3 where i3.firm_id = a.firm_id and i3.client_id = a.client_id and ${senior} in (i3.assignee_membership_id, i3.reviewer_membership_id)))))`;
  } else {
    return null; // BILLING_A — truthful empty
  }

  return `
with t as (select status, count(*)::int n from public.tasks t where t.firm_id = ${firm} and ${taskScope} group by status),
c as (select state, count(*)::int n from public.compliance_instances i where i.firm_id = ${firm} and ${cinScope} group by state),
d as (select count(*)::int groups,
             coalesce(sum(g.at_risk),0)::int at_risk,
             coalesce(sum(g.total),0)::int total
      from (select i.compliance_type_id, i.due_date, count(*)::int total,
                   count(*) filter (where i.state not in ('filed','acknowledgement_received','closed')
                                    and i.due_date <= (now() at time zone 'Asia/Kolkata')::date)::int at_risk
            from public.compliance_instances i
            where i.firm_id = ${firm} and ${cinScope}
            group by i.compliance_type_id, i.due_date) g),
r as (select count(*)::int n from public.review_items r where r.firm_id = ${firm} and r.status = 'pending' and ${revScope}),
al as (select count(*)::int n from public.alerts a where a.firm_id = ${firm} and ${alrScope}
       and (a.status = 'active' or (a.status = 'snoozed' and a.snoozed_until is not null and a.snoozed_until <= now() and a.acknowledged_at is null)))
select jsonb_build_object(
  'tasks_by_status', coalesce((select jsonb_object_agg(status, n) from t), '{}'::jsonb),
  'instances_by_state', coalesce((select jsonb_object_agg(state, n) from c), '{}'::jsonb),
  'deadline', (select jsonb_build_object('groups', groups, 'at_risk_instances', at_risk, 'total_instances', total) from d),
  'pending_reviews', (select n from r),
  'active_alerts', (select n from al)
);`;
}

function groundTruth(roleKey) {
  if (roleKey === 'BILLING_A') return zeroCounters();
  const out = psql(gtSql(roleKey));
  const line = out.trim().split('\n').pop();
  return normalizeCounters(JSON.parse(line));
}

// ---------------------------------------------------------------------------
// EXPLAIN (ANALYZE, BUFFERS) under an emulated authenticated session
// ---------------------------------------------------------------------------
function explain(session, firm, label, sql) {
  const claims = JSON.stringify(decodeJwt(session.token)).replaceAll("'", "''");
  const planRaw = psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '${claims}';
set local request.headers = '{"x-active-firm":"${firm}"}';
explain (analyze, buffers, format json) ${sql}
rollback;`);
  const lines = planRaw.split('\n');
  const jsonStart = lines.findIndex((l) => l.trim() === '[');
  const jsonEnd = lines.findLastIndex((l) => l.trim() === ']');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error(`could not locate EXPLAIN json for ${label}`);
  const plan = JSON.parse(lines.slice(jsonStart, jsonEnd + 1).join('\n'))[0];
  const findScans = (node, acc = []) => {
    if (node['Node Type']?.includes('Scan')) {
      acc.push(`${node['Node Type']} on ${node['Relation Name']}${node['Index Name'] ? ' using ' + node['Index Name'] : ''}`);
    }
    for (const child of node.Plans ?? []) findScans(child, acc);
    return acc;
  };
  results.plans[label] = {
    planningMs: plan['Planning Time'],
    executionMs: plan['Execution Time'],
    scans: findScans(plan.Plan),
  };
  console.log(`  plan ${label}: planning=${plan['Planning Time']}ms execution=${plan['Execution Time']}ms`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let setupDone = false;
let gateFailure = false;

async function main() {
  // 0. FAIL-CLOSED local safety — before ANY write.
  assertLocalSafety();
  localEnv();
  console.log(`RUNS_PER_CASE=${RUNS} WARMUP=${WARMUP} B_VARIANTS=${B_VARIANTS.join(',')}`);

  // Preflight (read-only): no residue, no leftover Candidate A object.
  const residue = psql(`
select coalesce(sum(n),0) from (
  select count(*) n from public.clients              where id::text like '0a030000-0000-4000-8000-%'
  union all select count(*) from public.tasks        where id::text like '0a030000-0000-4000-8000-%'
  union all select count(*) from public.alerts       where id::text like '0a030000-0000-4000-8000-%'
  union all select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname = '${CANDIDATE_A_FN}'
) x;`);
  if (residue.trim() !== '0') {
    throw new Error('benchmark residue detected — run `node scripts/spikes/api-oq-03/teardown.mjs` first');
  }

  // 1. Synthetic setup (state-changing — the authorized runtime step).
  console.log('== API-OQ-03 spike: synthetic setup ==');
  const setupOut = psqlFile(SETUP_SQL);
  console.log(setupOut.trim().split('\n').map((l) => '  ' + l).join('\n'));
  setupDone = true;
  results.dataset = {
    firms: 2, clients_per_firm: 200, compliance_instances_per_firm: 5000,
    tasks_per_firm: 10000, review_items_per_firm: 1000, alerts_per_firm: 500,
  };
  console.log(`DATASET_SCALE=firms:2,clients:200,instances:5000,tasks:10000,reviews:1000,alerts:500 per firm`);

  // 2. Sign-ins (real password grant, anon key — the application path).
  console.log('== Signing in harness personas ==');
  const sessions = {};
  for (const rc of ROLE_CASES) sessions[rc.key] = await signIn(userEmail(rc.user));
  sessions.PARTNER_B = await signIn(userEmail('USER_B_PARTNER'));
  sessions.SUSPENDED_A = await signIn(userEmail('USER_A_SUSPENDED'));
  sessions.REMOVED_A = await signIn(userEmail('USER_A_REMOVED'));

  // 3. Ground truth per role.
  console.log('== Ground truth (superuser SQL replicating RLS scope; gate use only) ==');
  for (const rc of ROLE_CASES) {
    results.groundTruth[rc.key] = groundTruth(rc.key);
    const gt = results.groundTruth[rc.key];
    console.log(`  ${rc.key}: tasks=${Object.values(gt.tasks_by_status).reduce((a, b) => a + b, 0)} instances=${Object.values(gt.instances_by_state).reduce((a, b) => a + b, 0)} pending_reviews=${gt.pending_reviews} active_alerts=${gt.active_alerts} at_risk=${gt.deadline.at_risk_instances}`);
  }

  // 4. Semantic-equivalence + security-correctness gates (per candidate).
  console.log('== Semantic equivalence + security correctness gates ==');
  const candidates = { A: runCandidateA };
  if (B_VARIANTS.includes('fetch')) candidates.B_fetch = runCandidateBFetch;
  if (B_VARIANTS.includes('counts')) candidates.B_counts = runCandidateBCounts;

  for (const [cand, fn] of Object.entries(candidates)) {
    for (const rc of ROLE_CASES) {
      const out = await fn(sessions[rc.key], rc.firm);
      const gt = results.groundTruth[rc.key];
      gate(`SEMANTIC_EQUIVALENCE[${cand}][${rc.key}]`, 'counters == role-scoped ground truth',
        `tasks=${Object.values(out.counters.tasks_by_status).reduce((a, b) => a + b, 0)} instances=${Object.values(out.counters.instances_by_state).reduce((a, b) => a + b, 0)} pending_reviews=${out.counters.pending_reviews} active_alerts=${out.counters.active_alerts} at_risk=${out.counters.deadline.at_risk_instances}`,
        countersEqual(out.counters, gt));
    }
    // Cross-firm: Firm A partner asserting Firm B context must see zeros.
    const crossA = await fn(sessions.PARTNER_A, FIRM_B);
    gate(`SECURITY[${cand}][A-partner -> B context]`, 'all-zero counters', JSON.stringify(crossA.counters) === JSON.stringify(zeroCounters()) ? 'zeros' : 'NONZERO', countersEqual(crossA.counters, zeroCounters()));
    // Foreign user asserting OUR firm header must see zeros.
    const crossB = await fn(sessions.PARTNER_B, FIRM_A);
    gate(`SECURITY[${cand}][B-partner -> A context]`, 'all-zero counters', countersEqual(crossB.counters, zeroCounters()) ? 'zeros' : 'NONZERO', countersEqual(crossB.counters, zeroCounters()));
    // Firm B partner in own context: firm-wide B (nonzero tasks proves scoping works both ways).
    const ownB = await fn(sessions.PARTNER_B, FIRM_B);
    const bTasks = Object.values(ownB.counters.tasks_by_status).reduce((a, b) => a + b, 0);
    gate(`SECURITY[${cand}][B-partner own firm]`, '10000 tasks (firm-wide B)', `${bTasks} tasks`, bTasks === 10000);
    // Suspended / removed memberships read nothing.
    for (const probe of ['SUSPENDED_A', 'REMOVED_A']) {
      const r = await fn(sessions[probe], FIRM_A);
      gate(`SECURITY[${cand}][${probe}]`, 'all-zero counters', countersEqual(r.counters, zeroCounters()) ? 'zeros' : 'NONZERO', countersEqual(r.counters, zeroCounters()));
    }
  }
  // Cross-candidate equality (manager is the most discriminating scope).
  {
    const a = normalizeCounters((await runCandidateA(sessions.MANAGER_A, FIRM_A)).counters);
    for (const [cand, fn] of Object.entries(candidates)) {
      if (cand === 'A') continue;
      const b = normalizeCounters((await fn(sessions.MANAGER_A, FIRM_A)).counters);
      gate(`SEMANTIC_EQUIVALENCE[A vs ${cand}][MANAGER_A]`, 'identical counters', countersEqual(a, b) ? 'equal' : 'DIFFERENT', countersEqual(a, b));
    }
  }

  gateFailure = results.gates.some((g) => !g.pass);
  const eqPass = results.gates.filter((g) => g.name.startsWith('SEMANTIC')).every((g) => g.pass);
  const secPass = results.gates.filter((g) => g.name.startsWith('SECURITY')).every((g) => g.pass);
  console.log(`SEMANTIC_EQUIVALENCE=${eqPass ? 'PASS' : 'FAIL'}`);
  console.log(`SECURITY_CORRECTNESS=${secPass ? 'PASS' : 'FAIL'}`);
  if (gateFailure) {
    console.log('API_OQ_03_RESULT=INVALID_MEASUREMENT');
    console.log('A gate failed — latency is NOT a valid basis for comparison. Skipping measurement.');
    return;
  }

  // 5. Measurement (interleaved per iteration to share cache conditions).
  console.log('== Measurement (warmup ' + WARMUP + ', recorded ' + RUNS + ' per candidate/role) ==');
  for (const rc of ROLE_CASES) {
    const series = { A: [], B_fetch: [], B_counts: [] };
    const meta = { A: { roundTrips: 0, payloadBytes: 0 }, B_fetch: {}, B_counts: {} };
    for (let i = 0; i < WARMUP + RUNS; i++) {
      for (const [cand, fn] of Object.entries(candidates)) {
        try {
          const out = await fn(sessions[rc.key], rc.firm);
          if (i >= WARMUP) {
            series[cand].push(out.ms);
            meta[cand].roundTrips = out.roundTrips;
            meta[cand].payloadBytes = out.payloadBytes;
            if (out.perSection) meta[cand].perSection = out.perSection;
          }
        } catch (e) {
          results.failures.push({ candidate: cand, role: rc.key, iteration: i, error: String(e.message ?? e) });
          console.log(`  [FAILED RUN] ${cand} ${rc.key} iter ${i}: ${e.message}`);
        }
      }
    }
    results.benchmarks[rc.key] = {};
    for (const cand of Object.keys(candidates)) {
      results.benchmarks[rc.key][cand] = { ...stats(series[cand]), ...meta[cand] };
      const s = results.benchmarks[rc.key][cand];
      console.log(`  ${cand} ${rc.key}: p50=${s.p50}ms p95=${s.p95}ms min=${s.min} max=${s.max} mean=${s.mean} n=${s.n} round_trips=${s.roundTrips} payload_bytes=${s.payloadBytes}`);
    }
  }

  // 6. Query plans (representative; emulated authenticated sessions).
  console.log('== Query plans (EXPLAIN ANALYZE, RLS active) ==');
  for (const rc of [ROLE_CASES[0], ROLE_CASES[1]]) {
    const s = sessions[rc.key];
    explain(s, rc.firm, `A:${rc.key}:rpc`, `select public.${CANDIDATE_A_FN}();`);
    explain(s, rc.firm, `B:${rc.key}:tasks`, `select status from public.tasks order by id limit 1000;`);
    explain(s, rc.firm, `B:${rc.key}:instances`, `select state from public.compliance_instances order by id limit 1000;`);
    explain(s, rc.firm, `B:${rc.key}:deadline_board`, `select group_id, at_risk, total_clients from public.deadline_board order by group_id;`);
    explain(s, rc.firm, `B:${rc.key}:reviews_pending`, `select id from public.review_items where status = 'pending' limit 0;`);
    explain(s, rc.firm, `B:${rc.key}:alerts`, `select status, snoozed_until, acknowledged_at from public.alerts order by id limit 1000;`);
  }

  // 7. Factual evidence lines (NEVER an architecture decision).
  console.log('\n== API-OQ-03 factual evidence (selection remains HUMAN-GATED) ==');
  for (const rc of ROLE_CASES) {
    for (const cand of Object.keys(candidates)) {
      const s = results.benchmarks[rc.key][cand];
      const label = `${cand.replace('B_', 'B-').toUpperCase()}_${rc.key}`;
      console.log(`CANDIDATE_${label}_P50_MS=${s.p50}`);
      console.log(`CANDIDATE_${label}_P95_MS=${s.p95}`);
      console.log(`CANDIDATE_${label}_MIN_MS=${s.min}`);
      console.log(`CANDIDATE_${label}_MAX_MS=${s.max}`);
      console.log(`CANDIDATE_${label}_MEAN_MS=${s.mean}`);
      console.log(`ROUND_TRIPS_${label}=${s.roundTrips}`);
      console.log(`PAYLOAD_BYTES_${label}=${s.payloadBytes}`);
    }
  }
  console.log(`MEASUREMENT_FAILURES=${results.failures.length}`);
}

try {
  await main();
} catch (e) {
  console.error(`SPIKE_ERROR=${e.message}`);
  process.exitCode = 1;
} finally {
  // 8. Cleanup — always attempted unless --keep; residue never hidden.
  if (setupDone && !KEEP) {
    console.log('== Cleanup ==');
    try {
      const out = psqlFile(TEARDOWN_SQL);
      console.log(out.trim().split('\n').map((l) => '  ' + l).join('\n'));
      const bad = out.split('\n').filter((l) => /residue_\w+=[1-9]/.test(l));
      results.cleanup = bad.length === 0 ? { status: 'PASS' } : { status: 'RESIDUE', detail: bad };
      console.log(bad.length === 0 ? 'CLEANUP_STATUS=PASS' : `CLEANUP_STATUS=RESIDUE ${bad.join(' | ')}`);
      if (bad.length > 0) process.exitCode = 1;
    } catch (e) {
      results.cleanup = { status: 'FAILED', error: String(e.message ?? e) };
      console.log(`CLEANUP_STATUS=FAILED ${e.message}`);
      process.exitCode = 1;
    }
  } else if (KEEP) {
    results.cleanup = { status: 'SKIPPED (--keep); run teardown.mjs' };
    console.log('CLEANUP_STATUS=SKIPPED(--keep) — residue intentionally retained; run node scripts/spikes/api-oq-03/teardown.mjs');
  }

  // 9. Persist structured report (no secrets).
  results.meta.completed = new Date().toISOString();
  results.meta.gateFailure = gateFailure;
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = `${RESULTS_DIR}/api-oq-03-results-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`REPORT_FILE=${file}`);
  } catch (e) {
    console.log(`REPORT_FILE=FAILED ${e.message}`);
  }
  if (gateFailure && process.exitCode !== 1) process.exitCode = 2;
  console.log('API_OQ_03_STATUS=OPEN');
  console.log('NOTE: this spike emits evidence only. Architecture selection (A vs B) is a HUMAN decision recorded in IMP-060; no normative threshold exists.');
}
