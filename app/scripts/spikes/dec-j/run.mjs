/**
 * IMP-004 / DEC-J spike — orchestration.
 *
 * Compares candidate A (JWT claims), B (live lookup), C (hybrid) for
 * tenant isolation, revocation freshness, role-change behaviour,
 * active-firm switching, staff/client overlap, stale/expired tokens,
 * policy complexity and performance — through the REAL Supabase request
 * path (anon key + user access tokens; service-role only for setup and
 * membership mutation).
 *
 * Usage: npm run spike:dec-j   (requires running local stack + IMP-003 harness)
 * Output: docs/harness/dec-j-results.json (no secrets)
 */
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  FIRM_A,
  FIRM_B,
  adminUpdateUser,
  api,
  decodeJwt,
  localEnv,
  percentile,
  psql,
  psqlFile,
  refreshSession,
  restartStack,
  signIn,
  sleep,
  userEmail,
  userId,
  waitForStack,
} from './lib.mjs';

const CONFIG = 'supabase/config.toml';
const CONFIG_BAK = 'scripts/spikes/dec-j/config.toml.bak';
const HOOK_BLOCK = `
# === DEC-J SPIKE (temporary; appended by scripts/spikes/dec-j/run.mjs, removed by teardown) ===
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/decj_access_token_hook"
`;

const results = {
  meta: {},
  correctness: [],
  freshness: [],
  switching: [],
  overlap: [],
  tokens: [],
  benchmarks: {},
  explains: {},
  jwtSizes: [],
};

function record(section, entry) {
  results[section].push(entry);
  const mark = entry.pass === undefined ? '-' : entry.pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${entry.candidate ?? ''} ${entry.test}: ${entry.observed}`);
}

function rowsOf(r) {
  return Array.isArray(r.body) ? r.body.length : 0;
}
function countOf(r) {
  // content-range: "0-24/60000" or "*/0"
  const m = (r.contentRange ?? '').match(/\/(\d+|\*)$/);
  return m ? (m[1] === '*' ? 0 : Number(m[1])) : null;
}
const isDenied = (r) => [401, 403].includes(r.status);

// ---------------------------------------------------------------------------
// 1. Setup
// ---------------------------------------------------------------------------
console.log('== DEC-J spike: setup ==');
const env = localEnv();
results.meta.date = new Date().toISOString();
results.meta.supabaseCli = (await import('node:child_process')).execSync('npx supabase --version', { encoding: 'utf8' }).trim();
results.meta.images = (await import('node:child_process'))
  .execSync("docker ps --format '{{.Names}} {{.Image}}' | grep -E 'gotrue|postgrest|postgres:'", { encoding: 'utf8', shell: '/bin/bash' })
  .trim()
  .split('\n');

console.log('Applying spike schema (setup.sql)...');
psqlFile('scripts/spikes/dec-j/setup.sql');
console.log(psql(`select 'resources_a='||count(*) from public.decj_resources_a`));

if (!existsSync(CONFIG_BAK)) copyFileSync(CONFIG, CONFIG_BAK);
if (!readFileSync(CONFIG, 'utf8').includes('decj_access_token_hook')) {
  appendFileSync(CONFIG, HOOK_BLOCK);
}
console.log('Restarting stack with custom access-token hook enabled...');
restartStack();
await waitForStack();
psql(`select pg_notify('pgrst', 'reload schema')`);
await sleep(1000);

// ---------------------------------------------------------------------------
// 2. Sign-ins (real password grant, anon key)
// ---------------------------------------------------------------------------
console.log('== Signing in harness users ==');
const sessions = {};
for (const key of [
  'USER_A_PARTNER',
  'USER_A_SENIOR',
  'USER_A_BILLING',
  'USER_A_MANAGER',
  'USER_B_PARTNER',
  'USER_MULTI_FIRM',
  'USER_CLIENT_OVERLAP',
]) {
  sessions[key] = await signIn(userEmail(key));
}
const tok = (k) => sessions[k].token;

// Sanity: hook claims present
const sampleClaims = decodeJwt(tok('USER_A_PARTNER'));
results.meta.hookClaimsPresent = Boolean(sampleClaims.decj);
console.log(`hook claims present on USER_A_PARTNER token: ${results.meta.hookClaimsPresent}`);
if (!results.meta.hookClaimsPresent) throw new Error('custom access token hook did not fire — aborting');

const hdrA = { 'x-active-firm': FIRM_A };
const hdrB = { 'x-active-firm': FIRM_B };
const hdrCtx = (firm, ctx) => ({ 'x-active-firm': firm, 'x-decj-context': ctx, Prefer: 'count=exact' });

// ---------------------------------------------------------------------------
// 3. Tenant-correctness matrix (per candidate)
// ---------------------------------------------------------------------------
console.log('== Tenant correctness matrix ==');
for (const [cand, table] of [['A', 'decj_resources_a'], ['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const hdr = cand === 'A' ? {} : hdrA;

  // same-firm authorized read
  let r = await api(tok('USER_A_PARTNER'), 'GET', `${table}?select=id&limit=5`, { headers: hdr });
  record('correctness', { candidate: cand, test: 'same-firm authorized read', expected: 'rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: r.status === 200 && rowsOf(r) > 0 });

  // cross-firm read via explicit foreign-firm filter
  r = await api(tok('USER_A_PARTNER'), 'GET', `${table}?select=id&firm_id=eq.${FIRM_B}&limit=5`, { headers: hdr });
  record('correctness', { candidate: cand, test: 'cross-firm read (foreign filter)', expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });

  // cross-firm read via foreign context selector (B/C only; A context is claim-bound)
  if (cand !== 'A') {
    r = await api(tok('USER_A_PARTNER'), 'GET', `${table}?select=id&limit=5`, { headers: hdrB });
    record('correctness', { candidate: cand, test: 'cross-firm read (foreign active-firm header)', expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });
    // foreign user asserting OUR firm header
    r = await api(tok('USER_B_PARTNER'), 'GET', `${table}?select=id&limit=5`, { headers: hdrA });
    record('correctness', { candidate: cand, test: 'foreign user asserting our firm header', expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });
  } else {
    // A: user with no relationship to B simply has claims for A; simulate attack by token of partner.b reading firm A filter
    r = await api(tok('USER_B_PARTNER'), 'GET', `${table}?select=id&firm_id=eq.${FIRM_A}&limit=5`);
    record('correctness', { candidate: cand, test: 'foreign user reading our firm rows', expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });
  }

  // known foreign record ID attack (firm-B rows occupy ids 60001..100000)
  r = await api(tok('USER_A_PARTNER'), 'GET', `${table}?select=id&id=eq.70000`, { headers: hdr });
  record('correctness', { candidate: cand, test: 'known foreign record ID attack', expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });

  // cross-firm insert
  r = await api(tok('USER_A_PARTNER'), 'POST', table, { headers: cand === 'A' ? {} : hdrB, body: { firm_id: FIRM_B, name: 'attack', amount: 1 } });
  record('correctness', { candidate: cand, test: 'cross-firm insert', expected: 'denied', observed: `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`, pass: isDenied(r) });

  // cross-firm update / delete (RLS hides the row)
  r = await api(tok('USER_A_PARTNER'), 'PATCH', `${table}?id=eq.70000`, { headers: cand === 'A' ? {} : hdrB, body: { name: 'attack' } });
  record('correctness', { candidate: cand, test: 'cross-firm update', expected: '0 rows affected', observed: `HTTP ${r.status}, ${rowsOf(r)} rows affected`, pass: rowsOf(r) === 0 });
  r = await api(tok('USER_A_PARTNER'), 'DELETE', `${table}?id=eq.70000`, { headers: cand === 'A' ? {} : hdrB });
  record('correctness', { candidate: cand, test: 'cross-firm delete', expected: '0 rows affected', observed: `HTTP ${r.status}, ${rowsOf(r)} rows affected`, pass: rowsOf(r) === 0 });

  // unauthorized role: billing cannot insert
  r = await api(tok('USER_A_BILLING'), 'POST', table, { headers: hdr, body: { firm_id: FIRM_A, name: 'billing-insert', amount: 1 } });
  record('correctness', { candidate: cand, test: 'unauthorized role insert (billing)', expected: 'denied', observed: `HTTP ${r.status}`, pass: isDenied(r) });

  // authorized role: partner insert + update + delete a sacrificial row
  r = await api(tok('USER_A_PARTNER'), 'POST', table, { headers: hdr, body: { firm_id: FIRM_A, name: 'sacrificial', amount: 1 } });
  const sacId = Array.isArray(r.body) ? r.body[0]?.id : null;
  record('correctness', { candidate: cand, test: 'authorized role insert (partner)', expected: '201', observed: `HTTP ${r.status}, id=${sacId}`, pass: r.status === 201 && sacId != null });
  r = await api(tok('USER_A_MANAGER'), 'PATCH', `${table}?id=eq.${sacId}`, { headers: hdr, body: { name: 'sacrificial-upd' } });
  record('correctness', { candidate: cand, test: 'authorized role update (manager)', expected: '1 row', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 1 });
  // unauthorized role: senior cannot delete
  r = await api(tok('USER_A_SENIOR'), 'DELETE', `${table}?id=eq.${sacId}`, { headers: hdr });
  record('correctness', { candidate: cand, test: 'unauthorized role delete (senior)', expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows affected`, pass: rowsOf(r) === 0 });
  r = await api(tok('USER_A_PARTNER'), 'DELETE', `${table}?id=eq.${sacId}`, { headers: hdr });
  record('correctness', { candidate: cand, test: 'authorized role delete (partner)', expected: '1 row', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 1 });
}

// Suspended / removed memberships (static harness states) — read attempts
console.log('== Suspended / removed membership (pre-seeded states) ==');
for (const [cand, table] of [['A', 'decj_resources_a'], ['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const hdr = cand === 'A' ? {} : hdrA;
  for (const [key, state] of [['USER_A_SUSPENDED', 'suspended'], ['USER_A_REMOVED', 'removed']]) {
    const s = await signIn(userEmail(key)); // sign-in itself still works; authorization must not
    const r = await api(s.token, 'GET', `${table}?select=id&limit=5`, { headers: hdr });
    record('correctness', { candidate: cand, test: `${state} membership read`, expected: '0 rows', observed: `HTTP ${r.status}, ${rowsOf(r)} rows`, pass: rowsOf(r) === 0 });
  }
}

// ---------------------------------------------------------------------------
// 4. Freshness: role downgrade, suspension, removal (stale vs fresh token)
// ---------------------------------------------------------------------------
console.log('== Freshness sequences ==');
const MEM = {
  seniorA: '30000000-0000-4000-8000-000000000004',
  managerA: '30000000-0000-4000-8000-000000000003',
};

// 4a. Role DOWNGRADE senior.a: partner -> senior (stale token keeps partner delete?)
psql(`update public.decj_memberships set role='partner', authz_version=2 where id='${MEM.seniorA}'`);
for (const [cand, table] of [['A', 'decj_resources_a'], ['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const hdr = cand === 'A' ? {} : hdrA;
  const s1 = await signIn(userEmail('USER_A_SENIOR')); // token with role=partner
  const ins = await api(s1.token, 'POST', table, { headers: hdr, body: { firm_id: FIRM_A, name: 'freshness-target', amount: 1 } });
  const targetId = ins.body?.[0]?.id;
  // downgrade
  psql(`update public.decj_memberships set role='senior', authz_version=3 where id='${MEM.seniorA}'`);
  const stale = await api(s1.token, 'DELETE', `${table}?id=eq.${targetId}`, { headers: hdr });
  const staleAllowed = rowsOf(stale) > 0;
  record('freshness', { candidate: cand, test: 'role downgrade: stale token retains old privilege', expected: cand === 'A' ? 'yes (stale)' : 'no', observed: staleAllowed ? `stale token DELETED row (HTTP ${stale.status})` : `stale token denied (${rowsOf(stale)} rows)`, pass: cand === 'A' ? staleAllowed : !staleAllowed });
  // fresh token must reflect the new role (delete denied) — re-insert target if stale deleted it
  if (staleAllowed) {
    const again = await api(s1.token, 'POST', table, { headers: hdr, body: { firm_id: FIRM_A, name: 'freshness-target', amount: 1 } });
    if (again.body?.[0]?.id) await api(s1.token, 'DELETE', `${table}?id=eq.${again.body[0].id}`, { headers: hdr });
  }
  const s2 = await signIn(userEmail('USER_A_SENIOR'));
  const ins2 = await api(s2.token, 'POST', table, { headers: hdr, body: { firm_id: FIRM_A, name: 'freshness-target-2', amount: 1 } });
  const t2 = ins2.body?.[0]?.id;
  const fresh = await api(s2.token, 'DELETE', `${table}?id=eq.${t2}`, { headers: hdr });
  record('freshness', { candidate: cand, test: 'role downgrade: fresh token has new (reduced) role', expected: 'delete denied', observed: `HTTP ${fresh.status}, ${rowsOf(fresh)} rows deleted`, pass: rowsOf(fresh) === 0 });
  // cleanup all freshness rows (stale-denied candidates leave targetId behind)
  if (t2) await api(tok('USER_A_PARTNER'), 'DELETE', `${table}?id=eq.${t2}`, { headers: hdr });
  await api(tok('USER_A_PARTNER'), 'DELETE', `${table}?id=eq.${targetId}`, { headers: hdr });
}
psql(`update public.decj_memberships set role='senior', authz_version=1 where id='${MEM.seniorA}'`);

// 4b. Suspension freshness: manager.a active -> suspended
for (const [cand, table] of [['A', 'decj_resources_a'], ['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const hdr = cand === 'A' ? {} : hdrA;
  const s1 = await signIn(userEmail('USER_A_MANAGER'));
  const before = await api(s1.token, 'GET', `${table}?select=id&limit=5`, { headers: hdr });
  psql(`update public.decj_memberships set status='suspended' where id='${MEM.managerA}'`);
  const stale = await api(s1.token, 'GET', `${table}?select=id&limit=5`, { headers: hdr });
  const staleAllowed = rowsOf(stale) > 0;
  record('freshness', { candidate: cand, test: 'suspension: stale token retains access', expected: cand === 'A' ? 'yes (stale)' : 'no', observed: `before=${rowsOf(before)} rows, stale-after-suspend=${rowsOf(stale)} rows`, pass: cand === 'A' ? staleAllowed : !staleAllowed });
  const s2 = await signIn(userEmail('USER_A_MANAGER'));
  const fresh = await api(s2.token, 'GET', `${table}?select=id&limit=5`, { headers: hdr });
  record('freshness', { candidate: cand, test: 'suspension: fresh token denied', expected: '0 rows', observed: `${rowsOf(fresh)} rows`, pass: rowsOf(fresh) === 0 });

  // 4c. Removal freshness (continues from suspended state)
  psql(`delete from public.decj_memberships where id='${MEM.managerA}'`);
  const staleDel = await api(s1.token, 'GET', `${table}?select=id&limit=5`, { headers: hdr });
  const staleDelAllowed = rowsOf(staleDel) > 0;
  record('freshness', { candidate: cand, test: 'removal: stale token retains access', expected: cand === 'A' ? 'yes (stale)' : 'no', observed: `stale-after-remove=${rowsOf(staleDel)} rows`, pass: cand === 'A' ? staleDelAllowed : !staleDelAllowed });
  const s3 = await signIn(userEmail('USER_A_MANAGER'));
  const freshDel = await api(s3.token, 'GET', `${table}?select=id&limit=5`, { headers: hdr });
  record('freshness', { candidate: cand, test: 'removal: fresh token denied', expected: '0 rows', observed: `${rowsOf(freshDel)} rows`, pass: rowsOf(freshDel) === 0 });
  // restore membership for later steps
  psql(`insert into public.decj_memberships (id,user_id,firm_id,role,status,authz_version) values ('${MEM.managerA}','${userId('USER_A_MANAGER')}','${FIRM_A}','manager','active',1) on conflict do nothing`);
}

// ---------------------------------------------------------------------------
// 5. Active-firm switching (USER_MULTI_FIRM: manager in A, senior in B)
// ---------------------------------------------------------------------------
console.log('== Active-firm switching (multi-firm user) ==');
for (const [cand, table] of [['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const s = await signIn(userEmail('USER_MULTI_FIRM'));
  const seq = [];
  let ok = true;
  for (const [firm, expectFirm] of [[FIRM_A, FIRM_A], [FIRM_B, FIRM_B], [FIRM_A, FIRM_A]]) {
    const r = await api(s.token, 'GET', `${table}?select=id,firm_id&limit=50`, { headers: { 'x-active-firm': firm } });
    const onlyExpected = r.body.every((row) => row.firm_id === expectFirm);
    ok = ok && r.status === 200 && r.body.length > 0 && onlyExpected;
    seq.push(`firm=${firm === FIRM_A ? 'A' : 'B'} -> ${r.body.length} rows, all-correct-tenant=${onlyExpected}`);
  }
  record('switching', { candidate: cand, test: 'A -> B -> A context switch (same token, header only)', expected: 'isolated each hop', observed: seq.join(' | '), pass: ok });
}

// Candidate A: switch requires trusted-server app_metadata change + token refresh
{
  const uid = userId('USER_MULTI_FIRM');
  await adminUpdateUser(uid, { decj_active_firm: FIRM_A, decj_context: 'staff' });
  let s = await signIn(userEmail('USER_MULTI_FIRM'));
  const preSwitchToken = s.token; // claim-bound to firm A
  const r1 = await api(preSwitchToken, 'GET', `decj_resources_a?select=id,firm_id&limit=50`);
  const okA = r1.body.length > 0 && r1.body.every((row) => row.firm_id === FIRM_A);
  await adminUpdateUser(uid, { decj_active_firm: FIRM_B, decj_context: 'staff' });
  s = await refreshSession(s.refreshToken);
  const r2 = await api(s.token, 'GET', `decj_resources_a?select=id,firm_id&limit=50`);
  const okB = r2.body.length > 0 && r2.body.every((row) => row.firm_id === FIRM_B);
  // stale pre-switch token must NOT see firm B (claim-bound)
  const staleLeak = (await api(preSwitchToken, 'GET', `decj_resources_a?select=id&firm_id=eq.${FIRM_B}&limit=5`)).body.length;
  await adminUpdateUser(uid, { decj_active_firm: FIRM_A, decj_context: 'staff' });
  s = await refreshSession(s.refreshToken);
  const r3 = await api(s.token, 'GET', `decj_resources_a?select=id,firm_id&limit=50`);
  const okA2 = r3.body.length > 0 && r3.body.every((row) => row.firm_id === FIRM_A);
  record('switching', { candidate: 'A', test: 'A -> B -> A context switch (trusted metadata + token refresh)', expected: 'isolated each hop; stale token cannot see new firm', observed: `A:${r1.body.length}ok=${okA} B:${r2.body.length}ok=${okB} A:${r3.body.length}ok=${okA2} stale-foreign-visible=${staleLeak}`, pass: okA && okB && okA2 && staleLeak === 0 });
  sessions.USER_MULTI_FIRM = s;
}

// ---------------------------------------------------------------------------
// 6. Staff + client overlap (USER_CLIENT_OVERLAP: senior in A + CL-100 grant)
// ---------------------------------------------------------------------------
console.log('== Staff/client overlap ==');
for (const [cand, table] of [['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const s = await signIn(userEmail('USER_CLIENT_OVERLAP'));
  const staff = await api(s.token, 'GET', `${table}?select=id&limit=1`, { headers: hdrCtx(FIRM_A, 'staff') });
  const client = await api(s.token, 'GET', `${table}?select=id&limit=1`, { headers: hdrCtx(FIRM_A, 'client') });
  const clientForeign = await api(s.token, 'GET', `${table}?select=id&limit=5`, { headers: hdrCtx(FIRM_B, 'client') });
  const clientWrite = await api(s.token, 'POST', table, { headers: hdrCtx(FIRM_A, 'client'), body: { firm_id: FIRM_A, name: 'client-write', amount: 1 } });
  const staffCount = countOf(staff);
  const clientCount = countOf(client);
  record('overlap', { candidate: cand, test: 'staff ctx sees full firm portfolio', expected: '60000', observed: `${staffCount}`, pass: staffCount === 60000 });
  record('overlap', { candidate: cand, test: 'client ctx sees only granted client rows', expected: '3000 (CL-100)', observed: `${clientCount}`, pass: clientCount === 3000 });
  record('overlap', { candidate: cand, test: 'client ctx to foreign firm', expected: '0', observed: `${rowsOf(clientForeign)} rows`, pass: rowsOf(clientForeign) === 0 });
  record('overlap', { candidate: cand, test: 'client ctx cannot write staff resource', expected: 'denied', observed: `HTTP ${clientWrite.status}`, pass: isDenied(clientWrite) });
}
// Candidate A overlap: context is a claim; switching context needs trusted metadata + refresh
{
  const uid = userId('USER_CLIENT_OVERLAP');
  await adminUpdateUser(uid, { decj_active_firm: FIRM_A, decj_context: 'staff' });
  let s = await signIn(userEmail('USER_CLIENT_OVERLAP'));
  const staff = await api(s.token, 'GET', `decj_resources_a?select=id&limit=1`, { headers: { Prefer: 'count=exact' } });
  await adminUpdateUser(uid, { decj_active_firm: FIRM_A, decj_context: 'client' });
  s = await refreshSession(s.refreshToken);
  const client = await api(s.token, 'GET', `decj_resources_a?select=id&limit=1`, { headers: { Prefer: 'count=exact' } });
  const clientWrite = await api(s.token, 'POST', 'decj_resources_a', { body: { firm_id: FIRM_A, name: 'client-write', amount: 1 } });
  record('overlap', { candidate: 'A', test: 'staff ctx sees full firm portfolio (claim context)', expected: '60000', observed: `${countOf(staff)}`, pass: countOf(staff) === 60000 });
  record('overlap', { candidate: 'A', test: 'client ctx sees only granted rows (claim context)', expected: '3000', observed: `${countOf(client)}`, pass: countOf(client) === 3000 });
  record('overlap', { candidate: 'A', test: 'client ctx cannot write staff resource', expected: 'denied', observed: `HTTP ${clientWrite.status}`, pass: isDenied(clientWrite) });
  await adminUpdateUser(uid, { decj_active_firm: FIRM_A, decj_context: 'staff' });
}

// ---------------------------------------------------------------------------
// 7. Expired token rejection (crafted with local JWT_SECRET — never committed)
// ---------------------------------------------------------------------------
{
  const { JWT_SECRET } = localEnv();
  const { createHmac } = await import('node:crypto');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId('USER_A_PARTNER'), role: 'authenticated', aud: 'authenticated',
    iat: now - 3700, exp: now - 100,
    decj: decodeJwt(tok('USER_A_PARTNER')).decj,
  };
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  const sig = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url');
  const expired = `${unsigned}.${sig}`;
  const r = await api(expired, 'GET', `decj_resources_b?select=id&limit=5`, { headers: hdrA });
  record('tokens', { candidate: 'all', test: 'expired access token rejected', expected: '401', observed: `HTTP ${r.status}`, pass: r.status === 401 });
}

// ---------------------------------------------------------------------------
// 8. Benchmarks (authorized hot-path read through PostgREST + RLS)
// ---------------------------------------------------------------------------
console.log('== Benchmarks ==');
const bench = { warmup: 25, measured: 200, pageSize: 25 };
results.meta.benchmark = bench;
for (const [cand, table] of [['A', 'decj_resources_a'], ['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
  const s = await signIn(userEmail('USER_A_PARTNER'));
  const hdr = cand === 'A' ? {} : hdrA;
  const path = `${table}?select=id,firm_id,name,amount&firm_id=eq.${FIRM_A}&order=id&limit=${bench.pageSize}`;
  const times = [];
  for (let i = 0; i < bench.warmup + bench.measured; i++) {
    const t0 = performance.now();
    const r = await api(s.token, 'GET', path, { headers: hdr });
    const dt = performance.now() - t0;
    if (r.status !== 200) throw new Error(`benchmark ${cand} iteration ${i} failed: HTTP ${r.status}`);
    if (i >= bench.warmup) times.push(dt);
  }
  times.sort((a, b) => a - b);
  results.benchmarks[cand] = {
    p50: +percentile(times, 50).toFixed(2),
    p95: +percentile(times, 95).toFixed(2),
    min: +times[0].toFixed(2),
    max: +times[times.length - 1].toFixed(2),
    n: times.length,
  };
  console.log(`  candidate ${cand}: p50=${results.benchmarks[cand].p50}ms p95=${results.benchmarks[cand].p95}ms min=${results.benchmarks[cand].min} max=${results.benchmarks[cand].max}`);
}

// EXPLAIN ANALYZE with emulated PostgREST session (role + GUCs)
console.log('== Query plans (EXPLAIN ANALYZE, RLS active) ==');
{
  const s = await signIn(userEmail('USER_A_PARTNER'));
  const claims = JSON.stringify(decodeJwt(s.token)).replaceAll("'", "''");
  for (const [cand, table] of [['A', 'decj_resources_a'], ['B', 'decj_resources_b'], ['C', 'decj_resources_c']]) {
    const planRaw = psql(`
begin;
set local role authenticated;
set local request.jwt.claims = '${claims}';
set local request.headers = '{"x-active-firm":"${FIRM_A}"}';
explain (analyze, buffers, format json)
  select id, firm_id, name, amount from public.${table}
  where firm_id = '${FIRM_A}' order by id limit ${bench.pageSize};
rollback;`);
    const lines = planRaw.split('\n');
    const jsonStart = lines.findIndex((l) => l.trim() === '[');
    const jsonEnd = lines.findLastIndex((l) => l.trim() === ']');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error(`could not locate EXPLAIN json for ${cand}: ${planRaw.slice(0, 200)}`);
    const plan = JSON.parse(lines.slice(jsonStart, jsonEnd + 1).join('\n'))[0];
    const root = plan.Plan;
    const findScans = (node, acc = []) => {
      if (node['Node Type']?.includes('Scan')) acc.push(`${node['Node Type']} on ${node['Relation Name']}${node['Index Name'] ? ' using ' + node['Index Name'] : ''}`);
      for (const child of node.Plans ?? []) findScans(child, acc);
      return acc;
    };
    results.explains[cand] = {
      planningMs: plan['Planning Time'],
      executionMs: plan['Execution Time'],
      scans: findScans(root),
    };
    console.log(`  candidate ${cand}: planning=${plan['Planning Time']}ms execution=${plan['Execution Time']}ms scans=[${findScans(root).join('; ')}]`);
  }
}

// ---------------------------------------------------------------------------
// 9. JWT size vs membership count (multi-firm user: 2 -> 5 -> 20 memberships)
// ---------------------------------------------------------------------------
console.log('== JWT size scaling ==');
{
  const uid = userId('USER_MULTI_FIRM');
  const measure = async (label) => {
    const s = await signIn(userEmail('USER_MULTI_FIRM'));
    const claims = decodeJwt(s.token);
    results.jwtSizes.push({
      label,
      membershipsEmbedded: claims.decj.memberships.length,
      tokenBytes: Buffer.byteLength(s.token),
      decjClaimBytes: Buffer.byteLength(JSON.stringify(claims.decj)),
    });
    console.log(`  ${label}: token=${Buffer.byteLength(s.token)}B decj=${Buffer.byteLength(JSON.stringify(claims.decj))}B memberships=${claims.decj.memberships.length}`);
  };
  {
    const s = await signIn(userEmail('USER_A_PARTNER'));
    const claims = decodeJwt(s.token);
    results.jwtSizes.push({
      label: '1 membership',
      membershipsEmbedded: claims.decj.memberships.length,
      tokenBytes: Buffer.byteLength(s.token),
      decjClaimBytes: Buffer.byteLength(JSON.stringify(claims.decj)),
    });
    console.log(`  1 membership: token=${Buffer.byteLength(s.token)}B`);
  }
  await measure('2 memberships (multi-firm)');
  psql(`insert into public.decj_memberships (id,user_id,firm_id,role,status)
        select ('30000000-0000-4000-8000-0000000001'||lpad(to_hex(g),2,'0'))::uuid, '${uid}',
               ('10000000-0000-4000-8000-'||lpad(to_hex(61440+g),12,'0'))::uuid, 'senior', 'active'
        from generate_series(1,3) g on conflict do nothing`);
  await measure('5 memberships');
  psql(`insert into public.decj_memberships (id,user_id,firm_id,role,status)
        select ('30000000-0000-4000-8000-0000000001'||lpad(to_hex(g),2,'0'))::uuid, '${uid}',
               ('10000000-0000-4000-8000-'||lpad(to_hex(61440+g),12,'0'))::uuid, 'senior', 'active'
        from generate_series(4,18) g on conflict do nothing`);
  await measure('20 memberships');
  psql(`delete from public.decj_memberships where firm_id in (select id from public.decj_firms where label like 'Spike Filler %')`);
}

// ---------------------------------------------------------------------------
// 10. Persist results
// ---------------------------------------------------------------------------
results.meta.completed = new Date().toISOString();
writeFileSync('docs/harness/dec-j-results.json', JSON.stringify(results, null, 2));
const failures = [...results.correctness, ...results.freshness, ...results.switching, ...results.overlap, ...results.tokens].filter((r) => r.pass === false);
console.log(`\n== DEC-J spike run complete ==`);
console.log(`results written to docs/harness/dec-j-results.json`);
console.log(`assertion failures (unexpected behaviour): ${failures.length}`);
for (const f of failures) console.log(`  UNEXPECTED: ${f.candidate} ${f.test} -> ${f.observed}`);
console.log('NOTE: spike objects remain installed for inspection. Run npm run spike:dec-j:cleanup to remove them.');
