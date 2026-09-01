/**
 * IMP-004 / DEC-J — INDEPENDENT REVIEW FOLLOW-UP.
 *
 * Question: does Candidate B's live membership lookup stay acceptable at
 * representative membership-table scale (~100k membership rows)?
 * Compares B and C ONLY. Appends results to docs/harness/dec-j-results.json
 * under `followup` and prints a summary. Does not re-run candidate A.
 *
 * Usage: npm run spike:dec-j:followup  (then npm run spike:dec-j:cleanup)
 */
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  FIRM_A,
  FIRM_B,
  api,
  decodeJwt,
  localEnv,
  percentile,
  psql,
  psqlFile,
  signIn,
  userEmail,
  userId,
  restartStack,
  waitForStack,
  sleep,
} from './lib.mjs';

const CONFIG = 'supabase/config.toml';
const CONFIG_BAK = 'scripts/spikes/dec-j/config.toml.bak';
const HOOK_BLOCK = `
# === DEC-J SPIKE (temporary; appended by scripts/spikes/dec-j/followup.mjs, removed by teardown) ===
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/decj_access_token_hook"
`;

const followup = {
  label: 'INDEPENDENT REVIEW FOLLOW-UP',
  date: new Date().toISOString(),
  question: 'Candidate B live membership lookup at ~100k membership rows vs Candidate C',
  membershipRows: null,
  correctness: [],
  benchmarks: {},
  scaling: {},
  explains: {},
  jwtSizes: [],
  signInLatencyMs: {},
};

function record(entry) {
  followup.correctness.push(entry);
  console.log(`  [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.candidate} ${entry.test}: ${entry.observed}`);
}
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.length : 0);
const countOf = (r) => {
  const m = (r.contentRange ?? '').match(/\/(\d+|\*)$/);
  return m ? (m[1] === '*' ? 0 : Number(m[1])) : null;
};
const isDenied = (r) => [401, 403].includes(r.status);
const hdrA = { 'x-active-firm': FIRM_A };
const hdrB = { 'x-active-firm': FIRM_B };

async function bench(cand, table, token, headers, n = 200) {
  const path = `${table}?select=id,firm_id,name,amount&firm_id=eq.${FIRM_A}&order=id&limit=25`;
  const times = [];
  for (let i = 0; i < 25 + n; i++) {
    const t0 = performance.now();
    const r = await api(token, 'GET', path, { headers });
    const dt = performance.now() - t0;
    if (r.status !== 200) throw new Error(`bench ${cand} iter ${i}: HTTP ${r.status}`);
    if (i >= 25) times.push(dt);
  }
  times.sort((a, b) => a - b);
  return { p50: +percentile(times, 50).toFixed(2), p95: +percentile(times, 95).toFixed(2), min: +times[0].toFixed(2), max: +times.at(-1).toFixed(2), n: times.length };
}

async function explain(cand, table, token) {
  const claims = JSON.stringify(decodeJwt(token)).replaceAll("'", "''");
  const planRaw = psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '${claims}';
set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
explain (analyze, buffers, format json)
  select id, firm_id, name, amount from public.${table}
  where firm_id = '${FIRM_A}' order by id limit 25;
rollback;`);
  const lines = planRaw.split('\n');
  const s = lines.findIndex((l) => l.trim() === '[');
  const e = lines.findLastIndex((l) => l.trim() === ']');
  const plan = JSON.parse(lines.slice(s, e + 1).join('\n'))[0];
  const scans = [];
  const walk = (node) => {
    if (node['Node Type']?.includes('Scan')) scans.push(`${node['Node Type']} on ${node['Relation Name']}${node['Index Name'] ? ' using ' + node['Index Name'] : ''}`);
    (node.Plans ?? []).forEach(walk);
  };
  walk(plan.Plan);
  return { planningMs: plan['Planning Time'], executionMs: plan['Execution Time'], scans };
}

// ---------------------------------------------------------------------------
console.log('== DEC-J follow-up: setup (base schema + 100k memberships) ==');
localEnv();
psqlFile('scripts/spikes/dec-j/setup.sql');
psqlFile('scripts/spikes/dec-j/followup.sql');
followup.membershipRows = Number(psql(`select count(*) from public.decj_memberships`));
console.log(`membership rows: ${followup.membershipRows}`);

if (!existsSync(CONFIG_BAK)) copyFileSync(CONFIG, CONFIG_BAK);
if (!readFileSync(CONFIG, 'utf8').includes('decj_access_token_hook')) appendFileSync(CONFIG, HOOK_BLOCK);
console.log('restarting stack with hook enabled...');
restartStack();
await waitForStack();
psql(`select pg_notify('pgrst', 'reload schema')`);
await sleep(1000);

const sessions = {};
for (const key of ['USER_A_PARTNER', 'USER_A_SENIOR', 'USER_A_MANAGER', 'USER_MULTI_FIRM', 'USER_CLIENT_OVERLAP']) {
  const t0 = performance.now();
  sessions[key] = await signIn(userEmail(key));
  followup.signInLatencyMs[key] = +(performance.now() - t0).toFixed(1);
}
if (!decodeJwt(sessions.USER_A_PARTNER.token).decj) throw new Error('hook did not fire — aborting');

// ---------------------------------------------------------------------------
// Critical B/C security regression at scale
// ---------------------------------------------------------------------------
console.log('== B/C correctness at 100k memberships ==');
const MEM = { seniorA: '30000000-0000-4000-8000-000000000004', managerA: '30000000-0000-4000-8000-000000000003' };

for (const [cand, table] of [['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const t = (k) => sessions[k].token;

  let r = await api(t('USER_A_PARTNER'), 'GET', `${table}?select=id&limit=5`, { headers: hdrA });
  record({ candidate: cand, test: 'same-firm authorized access', expected: 'rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: r.status === 200 && rowsOf(r) > 0 });

  r = await api(t('USER_A_PARTNER'), 'GET', `${table}?select=id&id=eq.70000`, { headers: hdrA });
  record({ candidate: cand, test: 'known foreign ID denial', expected: '0 rows', observed: `${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });

  r = await api(t('USER_A_PARTNER'), 'GET', `${table}?select=id&limit=5`, { headers: hdrB });
  record({ candidate: cand, test: 'cross-firm denial (foreign header)', expected: '0 rows', observed: `${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });

  r = await api(t('USER_A_PARTNER'), 'POST', table, { headers: hdrB, body: { firm_id: FIRM_B, name: 'attack', amount: 1 } });
  record({ candidate: cand, test: 'cross-firm insert denial', expected: 'denied', observed: `HTTP ${r.status}`, pass: isDenied(r) });

  // suspension with stale token
  const s1 = await signIn(userEmail('USER_A_MANAGER'));
  psql(`update public.decj_memberships set status='suspended' where id='${MEM.managerA}'`);
  r = await api(s1.token, 'GET', `${table}?select=id&limit=5`, { headers: hdrA });
  record({ candidate: cand, test: 'suspension: stale token access', expected: '0 rows', observed: `${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });

  // removal with stale token
  psql(`delete from public.decj_memberships where id='${MEM.managerA}'`);
  r = await api(s1.token, 'GET', `${table}?select=id&limit=5`, { headers: hdrA });
  record({ candidate: cand, test: 'removal: stale token access', expected: '0 rows', observed: `${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });
  psql(`insert into public.decj_memberships (id,user_id,firm_id,role,status,authz_version) values ('${MEM.managerA}','${userId('USER_A_MANAGER')}','${FIRM_A}','manager','active',1) on conflict do nothing`);

  // role downgrade partner->senior: stale token must not keep delete
  psql(`update public.decj_memberships set role='partner', authz_version=2 where id='${MEM.seniorA}'`);
  const d1 = await signIn(userEmail('USER_A_SENIOR'));
  const ins = await api(d1.token, 'POST', table, { headers: hdrA, body: { firm_id: FIRM_A, name: 'followup-target', amount: 1 } });
  const targetId = ins.body?.[0]?.id;
  psql(`update public.decj_memberships set role='senior', authz_version=3 where id='${MEM.seniorA}'`);
  r = await api(d1.token, 'DELETE', `${table}?id=eq.${targetId}`, { headers: hdrA });
  record({ candidate: cand, test: 'role downgrade: stale token retains delete', expected: 'no', observed: rowsOf(r) > 0 ? 'STALE DELETE SUCCEEDED' : 'denied', pass: rowsOf(r) === 0 });
  await api(sessions.USER_A_PARTNER.token, 'DELETE', `${table}?id=eq.${targetId}`, { headers: hdrA });

  // role upgrade senior->partner: B applies immediately; C fails closed until refresh
  const u1 = await signIn(userEmail('USER_A_SENIOR')); // issued with role=senior (v1)
  psql(`update public.decj_memberships set role='partner', authz_version=2 where id='${MEM.seniorA}'`);
  const ins2 = await api(sessions.USER_A_PARTNER.token, 'POST', table, { headers: hdrA, body: { firm_id: FIRM_A, name: 'followup-upgrade', amount: 1 } });
  const upId = ins2.body?.[0]?.id;
  r = await api(u1.token, 'DELETE', `${table}?id=eq.${upId}`, { headers: hdrA });
  const upgradeImmediate = rowsOf(r) > 0;
  record({ candidate: cand, test: 'role upgrade: stale token gains new role', expected: cand === 'B' ? 'immediate grant' : 'fail closed until refresh', observed: upgradeImmediate ? 'stale token DELETED (immediate grant)' : 'stale token denied (fails closed)', pass: cand === 'B' ? upgradeImmediate : !upgradeImmediate });
  await api(sessions.USER_A_PARTNER.token, 'DELETE', `${table}?id=eq.${upId}`, { headers: hdrA });
  psql(`update public.decj_memberships set role='senior', authz_version=1 where id='${MEM.seniorA}'`);

  // multi-firm switching
  let ok = true;
  const seq = [];
  for (const firm of [FIRM_A, FIRM_B, FIRM_A]) {
    r = await api(sessions.USER_MULTI_FIRM.token, 'GET', `${table}?select=id,firm_id&limit=50`, { headers: { 'x-active-firm': firm } });
    const good = r.body.length > 0 && r.body.every((row) => row.firm_id === firm);
    ok = ok && good;
    seq.push(`${firm === FIRM_A ? 'A' : 'B'}:${r.body.length}rows ok=${good}`);
  }
  record({ candidate: cand, test: 'multi-firm A->B->A switching', expected: 'isolated each hop', observed: seq.join(' | '), pass: ok });

  // staff/client overlap
  const s = await signIn(userEmail('USER_CLIENT_OVERLAP'));
  const staff = await api(s.token, 'GET', `${table}?select=id&limit=1`, { headers: { ...hdrA, 'x-decj-context': 'staff', Prefer: 'count=exact' } });
  const client = await api(s.token, 'GET', `${table}?select=id&limit=1`, { headers: { ...hdrA, 'x-decj-context': 'client', Prefer: 'count=exact' } });
  record({ candidate: cand, test: 'overlap: staff ctx full portfolio', expected: '60000', observed: `${countOf(staff)}`, pass: countOf(staff) === 60000 });
  record({ candidate: cand, test: 'overlap: client ctx granted rows only', expected: '3000', observed: `${countOf(client)}`, pass: countOf(client) === 3000 });
}

// ---------------------------------------------------------------------------
// Performance at scale
// ---------------------------------------------------------------------------
console.log('== B/C benchmarks at 100k memberships ==');
for (const [cand, table] of [['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  followup.benchmarks[cand] = await bench(cand, table, sessions.USER_A_PARTNER.token, hdrA);
  console.log(`  ${cand}: p50=${followup.benchmarks[cand].p50}ms p95=${followup.benchmarks[cand].p95}ms min=${followup.benchmarks[cand].min} max=${followup.benchmarks[cand].max}`);
  followup.explains[cand] = await explain(cand, table, sessions.USER_A_PARTNER.token);
  console.log(`  ${cand} plan: planning=${followup.explains[cand].planningMs}ms exec=${followup.explains[cand].executionMs}ms [${followup.explains[cand].scans.join('; ')}]`);
}

// ---------------------------------------------------------------------------
// Multi-firm scaling: 1 / 5 / 20 memberships
// ---------------------------------------------------------------------------
console.log('== 1/5/20 membership scaling ==');
const mfId = userId('USER_MULTI_FIRM');
const setFillerMemberships = (n) => {
  psql(`delete from public.decj_memberships where firm_id in (select id from public.decj_firms where label like 'Spike Filler %')`);
  if (n > 0) {
    psql(`insert into public.decj_memberships (id,user_id,firm_id,role,status)
          select gen_random_uuid(), '${mfId}', f.id, 'senior', 'active'
          from (select id from public.decj_firms where label like 'Spike Filler %' order by label limit ${n}) f`);
  }
};

// 1 membership: partner.a
{
  const s = await signIn(userEmail('USER_A_PARTNER'));
  const bB = await bench('B-1', 'decj_resources_b', s.token, hdrA, 100);
  const bC = await bench('C-1', 'decj_resources_c', s.token, hdrA, 100);
  followup.scaling['1'] = { B: bB, C: bC, tokenBytesC: Buffer.byteLength(s.token) };
  console.log(`  1 membership: B p50/p95=${bB.p50}/${bB.p95} C p50/p95=${bC.p50}/${bC.p95} token=${Buffer.byteLength(s.token)}B`);
}
for (const n of [3, 18]) {
  setFillerMemberships(n); // multifirm has 2 base -> 5 total, then 20 total
  const s = await signIn(userEmail('USER_MULTI_FIRM'));
  const total = decodeJwt(s.token).decj.memberships.length;
  const bB = await bench(`B-${total}`, 'decj_resources_b', s.token, hdrA, 100);
  const bC = await bench(`C-${total}`, 'decj_resources_c', s.token, hdrA, 100);
  followup.scaling[String(total)] = { B: bB, C: bC, tokenBytesC: Buffer.byteLength(s.token), decjClaimBytes: Buffer.byteLength(JSON.stringify(decodeJwt(s.token).decj)) };
  console.log(`  ${total} memberships: B p50/p95=${bB.p50}/${bB.p95} C p50/p95=${bC.p50}/${bC.p95} token=${Buffer.byteLength(s.token)}B`);
}
setFillerMemberships(0);

// B token size (no claims needed beyond identity) — measure raw token without decj reliance
{
  const s = await signIn(userEmail('USER_A_PARTNER'));
  followup.jwtSizes.push({ note: 'token bytes in hook-enabled env (B ignores decj claims)', tokenBytes: Buffer.byteLength(s.token) });
}

// ---------------------------------------------------------------------------
followup.completed = new Date().toISOString();
const resultsPath = 'docs/harness/dec-j-results.json';
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
results.followup = followup;
writeFileSync(resultsPath, JSON.stringify(results, null, 2));

const failures = followup.correctness.filter((c) => !c.pass);
console.log(`\n== follow-up complete == security regressions: ${failures.length}`);
for (const f of failures) console.log(`  REGRESSION: ${f.candidate} ${f.test} -> ${f.observed}`);
console.log('results appended to docs/harness/dec-j-results.json (key: followup)');
console.log('run npm run spike:dec-j:cleanup to remove spike objects.');
process.exit(failures.length ? 1 : 0);
