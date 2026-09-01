/**
 * IMP-005 / AUDIT-CONTEXT SPIKE — deterministic runner.
 * LOCAL ONLY. Compares audit/request-context propagation candidates:
 *   A = request-scoped DB context (request.headers GUC read in triggers)
 *   B = explicit RPC context (actor derived from auth.uid(), firm live-validated)
 *   C = controlled server wrapper (local Node boundary -> RPC)
 *
 * Prerequisites: local stack running + `npm run db:reset:harness`.
 * Applies scripts/spikes/audit-context/setup.sql, executes the full test
 * matrix, writes docs/harness/audit-context-results.json.
 * Spike objects remain until `npm run spike:audit-context:cleanup`.
 *
 * Usage: npm run spike:audit-context
 */
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import {
  FIRM_A,
  FIRM_B,
  api,
  localEnv,
  percentile,
  psql,
  psqlFile,
  signIn,
  sleep,
  userId,
  userEmail,
} from '../dec-j/lib.mjs';

const WRAPPER_PORT = 5499;
const WRAPPER_SECRET = randomUUID(); // runtime-only; never committed
const SUPPORT_SESSION = '70000000-0000-4000-8000-000000000001';

const results = {
  spike: 'IMP-005 — audit context propagation (AUD-OQ-02 / TEST-SPIKE-CTX-01/02)',
  executedAt: new Date().toISOString(),
  environment: {},
  candidateLettering:
    'Task lettering: A=header-GUC trigger, B=explicit RPC, C=server wrapper. ' +
    'spec 11 TEST-SPIKE-CTX-01 letters: A=RPC, B=header-GUC, C=security-definer wrapper.',
  tests: [],
  spoofMatrix: {},
  perf: {},
  evidence: {},
};
let failures = 0;
function check(id, ok, detail, extra = {}) {
  if (!ok) failures += 1;
  results.tests.push({ id, ok, detail, ...extra });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} — ${detail}`);
  return ok;
}
function q(sql) {
  const out = psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`);
  return JSON.parse(out);
}
const now = () => performance.now();

console.log('== IMP-005 audit-context spike ==');

// --- 0. Baseline: deterministic harness + setup ----------------------------
execSync('npm run db:verify:harness', { stdio: 'pipe' });
console.log('ok   baseline — 16 deterministic harness identities verified');
psqlFile('scripts/spikes/audit-context/setup.sql');
console.log('ok   setup.sql applied (audctx_* spike objects)');

results.environment = {
  node: process.version,
  supabaseCli: execSync('npx supabase --version', { encoding: 'utf8' }).trim(),
  postgres: psql('select version()').trim(),
  stack: 'local Supabase CLI, loopback-only network caos-supabase-local',
};

// --- 1. Sign-ins ------------------------------------------------------------
const [partnerA, seniorA, partnerB, suspendedA, removedA, overlap] = await Promise.all([
  signIn(userEmail('USER_A_PARTNER')),
  signIn(userEmail('USER_A_SENIOR')),
  signIn(userEmail('USER_B_PARTNER')),
  signIn(userEmail('USER_A_SUSPENDED')),
  signIn(userEmail('USER_A_REMOVED')),
  signIn(userEmail('USER_CLIENT_OVERLAP')),
]);
console.log('ok   sign-ins — partnerA, seniorA, partnerB, suspendedA, removedA, overlap');

const H = (firm, extra = {}) => ({ 'x-active-firm': firm, ...extra });

// --- 2. DIRECT POSTGREST: what does the database actually see? --------------
console.log('\n-- direct PostgREST probe --');
const probe = await api(partnerA.token, 'POST', 'rpc/audctx_probe_context', {
  headers: {
    'x-forwarded-for': '203.0.113.99',
    'x-correlation-id': 'probe-corr-1',
    'x-request-id': 'probe-req-1',
    'x-actor-user-id': userId('USER_B_PARTNER'),
    'x-actor-type': 'service',
    'user-agent': 'audctx-probe/1.0',
  },
  body: {},
});
const pc = probe.body;
results.evidence.directPostgrestProbe = pc;
check('PROBE-01', probe.status === 200 && pc.auth_uid === userId('USER_A_PARTNER'),
  `auth.uid() resolves to caller (${pc.auth_uid}) — JWT identity trusted`);
check('PROBE-02', pc.request_headers && !('authorization' in pc.request_headers) && !('apikey' in pc.request_headers),
  'request.headers GUC visible to SQL; credentials redacted in probe output');
check('PROBE-03', typeof pc.request_headers?.['x-forwarded-for'] === 'string'
  && pc.request_headers['x-forwarded-for'].startsWith('203.0.113.99')
  && pc.request_headers?.['x-actor-user-id'] === userId('USER_B_PARTNER'),
  `arbitrary client headers ARE visible as raw text; XFF arrives as client value + gateway-appended peer ("${pc.request_headers?.['x-forwarded-for']}") — left hops untrusted, right-most gateway-asserted`);
results.evidence.inetClientAddr = pc.inet_client_addr;
check('PROBE-04', true,
  `inet_client_addr() inside PostgREST = ${JSON.stringify(pc.inet_client_addr)} — the DB never sees the browser connection directly (PostgREST is the TCP peer)`);

// --- 3. GUC scope mechanics (pooling safety evidence) -----------------------
console.log('\n-- GUC scope / pooling --');
const gucLines = (sql) => psql(sql).trim().split('\n').filter((l) => !['BEGIN', 'COMMIT', 'SET'].includes(l));
const txLocal = gucLines(
  `begin; select set_config('app.audit_ctx','tx-value',true); commit; select 'post:' || coalesce(nullif(current_setting('app.audit_ctx',true),''),'<gone>');`,
).find((l) => l.startsWith('post:'));
check('GUC-01', txLocal === 'post:<gone>',
  `SET LOCAL / set_config(...,true) dies at transaction end (post-commit value: ${txLocal})`);
const sessionScope = gucLines(
  `select set_config('app.audit_ctx','session-value',false); select current_setting('app.audit_ctx',true);`,
).pop();
check('GUC-02', sessionScope === 'session-value',
  'session-level SET persists for the whole connection — DANGEROUS under pooling; any GUC mechanism must be transaction-local');
const setViaApi = await api(partnerA.token, 'POST', 'rpc/audctx_probe_set_ctx', { body: { p_value: 'req-value' } });
const getNextReq = await api(partnerA.token, 'POST', 'rpc/audctx_probe_get_ctx', { body: {} });
// PostgreSQL placeholder-GUC quirk: after a SET LOCAL dies, a pooled session
// reports '' (empty placeholder) rather than NULL. Both prove no value leak.
check('GUC-03', setViaApi.status === 200 && setViaApi.body === 'req-value'
  && getNextReq.status === 200 && (getNextReq.body === null || getNextReq.body === ''),
  `transaction-local GUC visible within its request, gone on the next pooled request (next=${JSON.stringify(getNextReq.body)} — placeholder quirk, no value leak)`);
results.evidence.gucScope = { txLocalAfterCommit: txLocal, sessionLevelPersists: sessionScope, nextRequestValue: getNextReq.body };

// --- 4. CANDIDATE A — header-GUC trigger path --------------------------------
console.log('\n-- Candidate A: direct PostgREST + header-GUC trigger --');
async function insertA(token, name, firm, headers = {}) {
  return api(token, 'POST', 'audctx_resources', {
    headers: H(firm, headers),
    body: { firm_id: firm, name, amount: 10 },
  });
}

// A1: context capture
await insertA(partnerA.token, 'A1', FIRM_A, {
  'x-correlation-id': 'a1-corr', 'x-request-id': 'a1-req',
  'x-forwarded-for': '203.0.113.7', 'user-agent': 'audctx-test/1.0',
});
let ev = q(`select actor_type, actor_user_id::text, firm_id::text, context, correlation_id, request_id, ip, user_agent, ctx_source
            from public.audctx_events where correlation_id = 'a1-corr'`);
check('A-01', ev.length === 1 && ev[0].actor_type === 'human' && ev[0].actor_user_id === userId('USER_A_PARTNER')
  && ev[0].firm_id === FIRM_A && ev[0].correlation_id === 'a1-corr' && ev[0].request_id === 'a1-req'
  && ev[0].ip?.startsWith('203.0.113.7') && ev[0].ip?.includes('172.20.0.1')
  && ev[0].user_agent === 'audctx-test/1.0' && ev[0].ctx_source === 'A-header-guc-trigger',
  `trigger captured actor (auth.uid), firm, correlation/request id, XFF ("${ev[0]?.ip}"), UA on a plain table write`);

// A2: actor spoof headers ignored
await insertA(partnerA.token, 'A2-SPOOF', FIRM_A, {
  'x-correlation-id': 'a2-corr', 'x-actor-user-id': userId('USER_B_PARTNER'),
  'x-actor-type': 'service', 'x-service-name': 'evil-daemon', 'x-support-session': randomUUID(),
});
ev = q(`select actor_type, actor_user_id::text, service_name, support_session_id from public.audctx_events where correlation_id = 'a2-corr'`);
check('A-02', ev.length === 1 && ev[0].actor_type === 'human' && ev[0].actor_user_id === userId('USER_A_PARTNER')
  && ev[0].service_name === null && ev[0].support_session_id === null,
  'spoofed x-actor-*/x-service-name/x-support-session headers IGNORED — actor stays auth.uid(), human');

// A3: XFF recorded verbatim (best-effort, spoofable) — but gateway appends its peer hop
await insertA(partnerA.token, 'A3-XFF', FIRM_A, { 'x-correlation-id': 'a3-corr', 'x-forwarded-for': '198.51.100.23' });
ev = q(`select ip from public.audctx_events where correlation_id = 'a3-corr'`);
check('A-03', ev.length === 1 && ev[0].ip?.startsWith('198.51.100.23') && ev[0].ip !== '198.51.100.23',
  `client-supplied XFF preserved verbatim + gateway-appended hop ("${ev[0]?.ip}") — client portion SPOOFABLE, best-effort evidence only (AUD-CTX-02)`);

// A4: sequential leakage A/B/A/B
for (const [t, n, f, c] of [
  [partnerA, 'SEQ-A1', FIRM_A, 'seq-a-1'],
  [partnerB, 'SEQ-B1', FIRM_B, 'seq-b-1'],
  [partnerA, 'SEQ-A2', FIRM_A, 'seq-a-2'],
  [partnerB, 'SEQ-B2', FIRM_B, 'seq-b-2'],
]) {
  await insertA(t.token, n, f, { 'x-correlation-id': c });
}
ev = q(`select correlation_id, actor_user_id::text, firm_id::text, new_value->>'name' as name
        from public.audctx_events where correlation_id like 'seq-%' order by id`);
const expectSeq = {
  'seq-a-1': [userId('USER_A_PARTNER'), FIRM_A, 'SEQ-A1'],
  'seq-b-1': [userId('USER_B_PARTNER'), FIRM_B, 'SEQ-B1'],
  'seq-a-2': [userId('USER_A_PARTNER'), FIRM_A, 'SEQ-A2'],
  'seq-b-2': [userId('USER_B_PARTNER'), FIRM_B, 'SEQ-B2'],
};
check('A-04', ev.length === 4 && ev.every((r) => {
  const e = expectSeq[r.correlation_id];
  return e && r.actor_user_id === e[0] && r.firm_id === e[1] && r.name === e[2];
}), 'sequential A/B/A/B requests: zero cross-request context leakage (actor, firm, correlation all correct)');

// A5: concurrent leakage (10 firm-A + 10 firm-B parallel)
await Promise.all(Array.from({ length: 20 }, (_, i) => {
  const isA = i % 2 === 0;
  return insertA(isA ? partnerA.token : partnerB.token, `CONC-${i}`, isA ? FIRM_A : FIRM_B, { 'x-correlation-id': `conc-${i}` });
}));
ev = q(`select correlation_id, actor_user_id::text, firm_id::text, new_value->>'name' as name
        from public.audctx_events where correlation_id like 'conc-%'`);
check('A-05', ev.length === 20 && ev.every((r) => {
  const i = Number(r.correlation_id.split('-')[1]);
  const isA = i % 2 === 0;
  return r.actor_user_id === userId(isA ? 'USER_A_PARTNER' : 'USER_B_PARTNER')
    && r.firm_id === (isA ? FIRM_A : FIRM_B) && r.name === `CONC-${i}`;
}), '20 concurrent pooled requests: zero context leakage across users/firms');

// A7/A8: authorization still enforced on the trigger path
let r = await insertA(partnerA.token, 'A-XFIRM', FIRM_B);
check('A-06', r.status >= 400, `cross-firm insert (A user -> firm B context) denied by RLS (HTTP ${r.status})`);
r = await insertA(suspendedA.token, 'A-SUSP', FIRM_A);
const suspDenied = r.status >= 400;
r = await insertA(removedA.token, 'A-REM', FIRM_A);
check('A-07', suspDenied && r.status >= 400, 'suspended and removed memberships denied on direct writes (live lookup)');

// A9: staff/client overlap isolation
r = await api(overlap.token, 'POST', 'audctx_resources', {
  headers: H(FIRM_A, { 'x-audctx-context': 'client', 'x-correlation-id': 'a9-client' }),
  body: { firm_id: FIRM_A, name: 'A9-CLIENT', amount: 1, client_key: 'CL-100' },
});
const clientOk = r.status === 201;
r = await api(overlap.token, 'POST', 'audctx_resources', {
  headers: H(FIRM_A, { 'x-audctx-context': 'client' }),
  body: { firm_id: FIRM_A, name: 'A9-CLIENT-NOGRANT', amount: 1 },
});
const clientNoGrantDenied = r.status >= 400;
r = await api(overlap.token, 'POST', 'audctx_resources', {
  headers: H(FIRM_A, { 'x-correlation-id': 'a9-staff' }),
  body: { firm_id: FIRM_A, name: 'A9-STAFF', amount: 1 },
});
ev = q(`select context, actor_type from public.audctx_events where correlation_id in ('a9-client','a9-staff') order by id`);
check('A-08', clientOk && clientNoGrantDenied && r.status === 201
  && ev.length === 2 && ev[0].context === 'client' && ev[1].context === 'staff',
  'overlap identity: client context requires live client grant; staff context uses membership; contexts do not inherit');

// --- 5. CANDIDATE B — explicit RPC context -----------------------------------
console.log('\n-- Candidate B: explicit RPC --');
async function rpcB(token, args, headers = {}) {
  return api(token, 'POST', 'rpc/audctx_b_create_resource', {
    headers: H(args.p_firm_id, headers),
    body: args,
  });
}

r = await rpcB(partnerA.token, { p_firm_id: FIRM_A, p_name: 'B1', p_amount: 5, p_correlation_id: 'b1-corr' });
ev = q(`select actor_type, actor_user_id::text, context, correlation_id, ctx_source from public.audctx_events where correlation_id = 'b1-corr'`);
check('B-01', r.status === 200 && ev.length === 1 && ev[0].actor_user_id === userId('USER_A_PARTNER')
  && ev[0].actor_type === 'human' && ev[0].context === 'staff' && ev[0].ctx_source === 'B-rpc',
  'RPC mutation+audit: actor derived from auth.uid(), firm live-validated, single audit row');

// B2: spoof keys in RPC body — PostgREST rejects unknown argument keys at
// the API boundary (function resolution fails), so they never reach SQL.
r = await rpcB(partnerA.token, {
  p_firm_id: FIRM_A, p_name: 'B2-SPOOF', p_amount: 5, p_correlation_id: 'b2-corr',
  actor_user_id: userId('USER_B_PARTNER'), actor_type: 'service',
  service_name: 'spoofed-svc', support_session_id: randomUUID(), p_actor_user_id: userId('USER_B_PARTNER'),
});
ev = q(`select count(*) as n from public.audctx_events where correlation_id = 'b2-corr'`);
const spoofRows = q(`select count(*) as n from public.audctx_resources where name = 'B2-SPOOF'`);
results.evidence.rpcSpoofHttpStatus = r.status;
check('B-02', r.status === 404 && ev[0].n === 0 && spoofRows[0].n === 0,
  `caller-supplied actor keys in RPC payload rejected at API boundary (HTTP ${r.status} — unknown args fail function resolution); actor can only derive from auth.uid()`);

r = await rpcB(partnerA.token, { p_firm_id: FIRM_B, p_name: 'B-XFIRM', p_amount: 5 });
check('B-03', r.status >= 400, `RPC foreign-firm spoof rejected by live membership validation (HTTP ${r.status}: ${r.body?.message ?? r.body?.code ?? ''})`);
r = await rpcB(suspendedA.token, { p_firm_id: FIRM_A, p_name: 'B-SUSP', p_amount: 5 });
const bSusp = r.status >= 400;
r = await rpcB(removedA.token, { p_firm_id: FIRM_A, p_name: 'B-REM', p_amount: 5 });
check('B-04', bSusp && r.status >= 400, 'RPC suspended/removed memberships rejected (live lookup, not token state)');

// B5: service actor — permission boundary
r = await api(partnerA.token, 'POST', 'rpc/audctx_service_event', {
  body: { p_firm_id: FIRM_A, p_action: 'SPOOF', p_object_type: 'x', p_object_id: 'x', p_service_name: 'browser-spoof' },
});
const svcDenied = r.status >= 400;
const { API_URL, SERVICE_ROLE_KEY, ANON_KEY } = localEnv();
const svcRes = await fetch(`${API_URL}/rest/v1/rpc/audctx_service_event`, {
  method: 'POST',
  headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_firm_id: FIRM_A, p_action: 'NightlyJob', p_object_type: 'audctx_resource', p_object_id: 'all', p_service_name: 'spike-job-runner', p_correlation_id: 'svc-1' }),
});
ev = q(`select actor_type, actor_user_id, service_name, correlation_id from public.audctx_events where correlation_id = 'svc-1'`);
check('B-05', svcDenied && svcRes.status === 200 && ev.length === 1 && ev[0].actor_type === 'service'
  && ev[0].actor_user_id === null && ev[0].service_name === 'spike-job-runner',
  `service actor: browser token DENIED (HTTP ${r.status}); service_role-only definer function writes actor_type=service, NULL user`);

// B6: support sessions
r = await api(partnerB.token, 'POST', 'rpc/audctx_support_event', {
  body: { p_session_id: SUPPORT_SESSION, p_action: 'VIEW_LEDGER', p_object_type: 'ledger', p_object_id: 'L-1' },
});
ev = q(`select actor_type, actor_user_id::text, support_session_id::text, firm_id::text from public.audctx_events where action = 'VIEW_LEDGER'`);
const supportOk = r.status === 200 && ev.length === 1 && ev[0].actor_type === 'support'
  && ev[0].actor_user_id === userId('USER_B_PARTNER') && ev[0].support_session_id === SUPPORT_SESSION
  && ev[0].firm_id === FIRM_A;
r = await api(partnerA.token, 'POST', 'rpc/audctx_support_event', {
  body: { p_session_id: SUPPORT_SESSION, p_action: 'STEAL', p_object_type: 'x', p_object_id: 'x' },
});
const otherSessionDenied = r.status >= 400;
r = await api(partnerB.token, 'POST', 'rpc/audctx_support_event', {
  body: { p_session_id: randomUUID(), p_action: 'GHOST', p_object_type: 'x', p_object_id: 'x' },
});
check('B-06', supportOk && otherSessionDenied && r.status >= 400,
  'support actor: valid open session writes actor+session id; another user\'s session and unknown sessions rejected');

// B7: overlap via RPC
r = await rpcB(overlap.token, { p_firm_id: FIRM_A, p_name: 'B7-CLIENT', p_amount: 1, p_client_key: 'CL-100', p_correlation_id: 'b7-client' });
const b7client = r.status === 200 && r.body?.context === 'client';
r = await rpcB(overlap.token, { p_firm_id: FIRM_A, p_name: 'B7-NOGRANT', p_amount: 1, p_client_key: 'CL-999' });
check('B-07', b7client && r.status >= 400,
  'RPC client context validated against live client_access grant (CL-100 ok, CL-999 denied)');

// --- 6. CANDIDATE C — controlled server wrapper ------------------------------
console.log('\n-- Candidate C: local server wrapper --');
const wrapper = spawn('node', ['scripts/spikes/audit-context/server.mjs'], {
  env: { ...process.env, API_URL, ANON_KEY, SERVICE_ROLE_KEY, WRAPPER_SECRET, WRAPPER_PORT: String(WRAPPER_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
wrapper.stdout.on('data', (d) => console.log('[wrapper]', String(d).trim()));
wrapper.stderr.on('data', (d) => console.error('[wrapper!]', String(d).trim()));
let wrapperUp = false;
for (let i = 0; i < 50 && !wrapperUp; i++) {
  try {
    const w = await fetch(`http://127.0.0.1:${WRAPPER_PORT}/nope`);
    if (w.status === 404) wrapperUp = true;
  } catch { await sleep(200); }
}
check('C-00', wrapperUp, 'wrapper listening on 127.0.0.1:5499 (loopback only)');

async function wrap(path, { token, headers = {}, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${WRAPPER_PORT}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body ?? {}),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

try {
  r = await wrap('/wrap/resource', {
    token: partnerA.token,
    headers: { 'x-correlation-id': 'c1-corr', 'user-agent': 'audctx-browser/1.0' },
    body: { firm_id: FIRM_A, name: 'C1', amount: 7 },
  });
  ev = q(`select actor_type, actor_user_id::text, correlation_id, request_id, ip, user_agent, ctx_source
          from public.audctx_events where correlation_id = 'c1-corr'`);
  check('C-01', r.status === 200 && r.body.request_id && r.body.correlation_id === 'c1-corr'
    && ev.length === 1 && ev[0].actor_user_id === userId('USER_A_PARTNER') && ev[0].request_id === r.body.request_id
    && ev[0].ctx_source === 'C-wrapper' && ev[0].ip !== null,
    `wrapper: token validated server-side, request_id generated server-side, IP observed by wrapper (${ev[0]?.ip}), RLS still enforced downstream`);

  r = await wrap('/wrap/resource', { body: { firm_id: FIRM_A, name: 'C-NOTOKEN', amount: 1 } });
  const noTok = r.status === 401;
  r = await wrap('/wrap/resource', { token: 'garbage.token.here', body: { firm_id: FIRM_A, name: 'C-BADTOK', amount: 1 } });
  check('C-02', noTok && r.status === 401, 'wrapper rejects missing and invalid tokens (401) before any DB work');

  r = await wrap('/wrap/resource', {
    token: partnerA.token,
    headers: { 'x-correlation-id': 'c3-corr', 'x-actor-user-id': userId('USER_B_PARTNER'), 'x-actor-type': 'service', 'x-wrapper-secret': WRAPPER_SECRET },
    body: { firm_id: FIRM_A, name: 'C3-SPOOF', amount: 1 },
  });
  ev = q(`select actor_type, actor_user_id::text from public.audctx_events where correlation_id = 'c3-corr'`);
  check('C-03', r.status === 200 && ev.length === 1 && ev[0].actor_type === 'human'
    && ev[0].actor_user_id === userId('USER_A_PARTNER'),
    'caller spoof headers (x-actor-*, even the wrapper secret) cannot change identity on the human path');

  r = await wrap('/wrap/service-event', { body: { firm_id: FIRM_A, action: 'BROWSER-ATTEMPT' } });
  const noSecret = r.status === 403;
  r = await wrap('/wrap/service-event', {
    headers: { 'x-wrapper-secret': WRAPPER_SECRET },
    body: { firm_id: FIRM_A, action: 'ScheduledComplianceSweep', correlation_id: 'c4-svc' },
  });
  ev = q(`select actor_type, actor_user_id, service_name from public.audctx_events where correlation_id = 'c4-svc'`);
  check('C-04', noSecret && r.status === 200 && ev.length === 1 && ev[0].actor_type === 'service'
    && ev[0].actor_user_id === null && ev[0].service_name === 'audctx-spike-wrapper',
    'service path: secret-less call 403; server-side call writes actor_type=service with server-fixed service_name (browser can never reach service role)');

  r = await wrap('/wrap/resource', { token: partnerA.token, body: { firm_id: FIRM_B, name: 'C5-XFIRM', amount: 1 } });
  check('C-05', r.status >= 400, `wrapper foreign-firm attempt rejected downstream by live validation (HTTP ${r.status})`);
} finally {
  wrapper.kill();
}

// --- 7. Audit-write failure -> mutation rollback (fail closed) ---------------
console.log('\n-- audit-failure atomicity --');
// F1: trigger path, transaction-level (psql; simulates request JWT claims)
psql(`do $$
begin
  begin
    perform set_config('request.jwt.claims', '{"sub":"${userId('USER_A_PARTNER')}","role":"authenticated"}', true);
    perform set_config('app.audctx_fault', 'fail_audit', true);
    insert into public.audctx_resources (firm_id, name, amount) values ('${FIRM_A}', 'F1-FAULT', 1);
    raise exception 'F1-UNEXPECTED-SUCCESS';
  exception
    when check_violation then
      raise notice 'audit failure aborted the transaction as expected';
  end;
end $$`);
let cnt = q(`select (select count(*) from public.audctx_resources where name = 'F1-FAULT') as resources,
                    (select count(*) from public.audctx_events where new_value->>'name' = 'F1-FAULT') as events`);
check('F-01', cnt[0].resources === 0 && cnt[0].events === 0,
  'A path: forced audit-write failure rolled back the resource mutation in the same transaction (0 rows, 0 events)');

// F2: RPC path via PostgREST (real request) — dedicated fault-injection RPC
r = await api(partnerA.token, 'POST', 'rpc/audctx_b_create_resource_faulty', {
  headers: H(FIRM_A),
  body: { p_firm_id: FIRM_A, p_name: 'F2-FAULT', p_amount: 1 },
});
const f2Status = r.status;
cnt = q(`select (select count(*) from public.audctx_resources where name = 'F2-FAULT') as resources,
                (select count(*) from public.audctx_events where object_id = (select max(id)::text from public.audctx_resources where name = 'F2-FAULT')) as events`);
check('F-02', f2Status >= 400 && cnt[0].resources === 0 && cnt[0].events === 0,
  `B path: masquerading audit row rejected (HTTP ${f2Status}); mutation+audit failed atomically — fail-closed verified`);

// Actor-model CHECK backstop (privileged psql writer)
psql(`do $$
begin
  begin
    insert into public.audctx_events (actor_type, actor_user_id, action, ctx_source)
    values ('system', '${userId('USER_A_PARTNER')}', 'MASQUERADE', 'psql-test');
    raise exception 'CHECK-UNEXPECTED-SUCCESS';
  exception
    when check_violation then
      raise notice 'actor-model CHECK rejected system row carrying a human user id';
  end;
end $$`);
cnt = q(`select count(*) as n from public.audctx_events where actor_type = 'system' and ctx_source = 'psql-admin'`);
check('F-03', cnt[0].n === 1,
  'actor-model CHECK (AUD-ACT-05): system+actor_user_id rejected even for privileged writers; legitimate system seed row intact');

// --- 8. Performance ------------------------------------------------------------
console.log('\n-- performance (secondary to trustworthiness) --');
async function bench(label, fn, warmup = 15, n = 120) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = now();
    await fn(i);
    times.push(now() - t0);
  }
  times.sort((a, b) => a - b);
  results.perf[label] = {
    runs: n,
    p50: Number(percentile(times, 50).toFixed(2)),
    p95: Number(percentile(times, 95).toFixed(2)),
    min: Number(times[0].toFixed(2)),
    max: Number(times[times.length - 1].toFixed(2)),
  };
  console.log(`     ${label}: p50=${results.perf[label].p50}ms p95=${results.perf[label].p95}ms (n=${n})`);
}
await bench('A_direct_postgrest_trigger', (i) =>
  insertA(partnerA.token, `PERF-A-${i}`, FIRM_A, { 'x-correlation-id': `perf-a-${i}` }));
await bench('B_rpc', (i) =>
  rpcB(partnerA.token, { p_firm_id: FIRM_A, p_name: `PERF-B-${i}`, p_amount: 1, p_correlation_id: `perf-b-${i}` }));
const wrapper2 = spawn('node', ['scripts/spikes/audit-context/server.mjs'], {
  env: { ...process.env, API_URL, ANON_KEY, SERVICE_ROLE_KEY, WRAPPER_SECRET, WRAPPER_PORT: String(WRAPPER_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try { const w = await fetch(`http://127.0.0.1:${WRAPPER_PORT}/nope`); if (w.status === 404) up = true; } catch { await sleep(200); }
  }
  await bench('C_wrapper_rpc', (i) =>
    wrap('/wrap/resource', { token: partnerA.token, body: { firm_id: FIRM_A, name: `PERF-C-${i}`, amount: 1 } }));
} finally {
  wrapper2.kill();
}

// --- 9. Spoof matrix + trust classification -----------------------------------
results.trustClassification = {
  'auth.uid()': 'TRUSTED (GoTrue-validated JWT, request.jwt.claims GUC set by PostgREST)',
  'selected firm_id (header/body)': 'UNTRUSTED context until live FirmMembership/client_access validation (DEC-J)',
  'caller-provided actor_user_id': 'UNTRUSTED — never accepted by any candidate; actor always derived',
  'caller-provided actor_type=service': 'UNTRUSTED — service identity only via service_role-only definer function',
  'correlation_id': 'UNTRUSTED-METADATA — recordable, end-to-end linkage (AUD-INV-06), not authorization evidence',
  'request_id': 'A/B: UNTRUSTED-METADATA if client-supplied; C: server-generated (trusted provenance)',
  'user-agent': 'UNTRUSTED-METADATA — client-controlled header',
  'IP (x-forwarded-for)': 'UNTRUSTED-METADATA — spoofable verbatim (A-03); C wrapper-observed socket IP is stronger but still proxy-dependent (AUD-CTX-02 best-effort)',
  'inet_client_addr()': 'DERIVED but useless for browser identity — always the PostgREST peer (PROBE-04)',
};
results.spoofMatrix = {
  actor_user_id: { A: 'IGNORED (A-02)', B: 'IGNORED — derived from auth.uid() (B-02)', C: 'IGNORED — derived from validated token (C-03)' },
  actor_type: { A: 'IGNORED (A-02)', B: 'IGNORED — human via RPC; service only via service_role function (B-05)', C: 'IGNORED on human path; service path server-secret gated (C-04)' },
  firm_id: { A: 'VALIDATED — RLS live lookup, foreign firm denied (A-06)', B: 'VALIDATED — explicit live check (B-03)', C: 'VALIDATED — downstream live check (C-05)' },
  service_name: { A: 'IGNORED (A-02)', B: 'server-only via definer function (B-05)', C: 'server-fixed constant (C-04)' },
  support_session: { A: 'IGNORED (A-02)', B: 'VALIDATED — open session owned by caller (B-06)', C: 'not exposed by wrapper' },
  correlation_id: { A: 'UNTRUSTED-METADATA recorded (A-01)', B: 'UNTRUSTED-METADATA recorded (B-01)', C: 'accepted or generated server-side, recorded (C-01)' },
  request_id: { A: 'UNTRUSTED-METADATA (A-01)', B: 'UNTRUSTED-METADATA', C: 'server-generated UUID (C-01)' },
  ip_headers: { A: 'UNTRUSTED-METADATA — spoofable (A-03)', B: 'UNTRUSTED-METADATA', C: 'wrapper-observed socket IP (stronger, proxy-dependent) (C-01)' },
  user_agent: { A: 'UNTRUSTED-METADATA (A-01)', B: 'UNTRUSTED-METADATA', C: 'wrapper-observed header (C-01)' },
};

// --- 10. Results ---------------------------------------------------------------
results.summary = {
  total: results.tests.length,
  passed: results.tests.filter((t) => t.ok).length,
  failed: failures,
};
writeFileSync('docs/harness/audit-context-results.json', JSON.stringify(results, null, 2));
console.log(`\n== ${results.summary.passed}/${results.summary.total} checks passed; evidence -> docs/harness/audit-context-results.json ==`);
process.exit(failures === 0 ? 0 : 1);
