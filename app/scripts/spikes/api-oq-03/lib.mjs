/**
 * IMP-060 / API-OQ-03 LOCAL measurement spike — shared helpers.
 *
 * LOCAL ONLY. Fail-closed: refuses to run unless every discovered endpoint
 * is the loopback Supabase dev stack. Never prints secrets (keys, DB URLs,
 * tokens) — only the non-secret safety marker.
 *
 * Mirrors scripts/spikes/dec-j/lib.mjs conventions.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const REGISTRY = JSON.parse(
  readFileSync(new URL('../../../tests/harness/registry.json', import.meta.url), 'utf8'),
);

export const FIRM_A = REGISTRY.firms.FIRM_A.id;
export const FIRM_B = REGISTRY.firms.FIRM_B.id;
export const PASSWORD = REGISTRY.passwordLocalOnly;

export function userId(key) {
  return REGISTRY.users[key].id;
}
export function userEmail(key) {
  return REGISTRY.users[key].email;
}

/** Deterministic spike UUID namespace: 0a030000-0000-4000-8000-FFKKNNNNNNNN. */
export const BENCH_ID_PREFIX = '0a030000-0000-4000-8000-';
export const MEM = {
  partnerA: `${BENCH_ID_PREFIX}0a0700000001`,
  managerA: `${BENCH_ID_PREFIX}0a0700000002`,
  seniorA: `${BENCH_ID_PREFIX}0a0700000003`,
  billingA: `${BENCH_ID_PREFIX}0a0700000004`,
  suspendedA: `${BENCH_ID_PREFIX}0a0700000005`,
  removedA: `${BENCH_ID_PREFIX}0a0700000006`,
  partnerB: `${BENCH_ID_PREFIX}0b0700000001`,
};
export const CANDIDATE_A_FN = 'api_oq_03_bench_dashboard';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

let cachedEnv = null;

/**
 * Discover local stack env via the Supabase CLI and PROVE the target is the
 * loopback dev stack. Throws (fail closed) on any non-local signal. The
 * returned object contains secrets — callers must never print it.
 */
export function localEnv() {
  if (cachedEnv) return cachedEnv;
  let out;
  try {
    out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error('local safety: `npx supabase status` failed — is the LOCAL stack running? (npm run db:start)');
  }
  const env = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="(.*)"$/);
    if (m) env[m[1]] = m[2];
  }
  for (const k of ['API_URL', 'ANON_KEY', 'JWT_SECRET']) {
    if (!env[k]) throw new Error(`local safety: missing ${k} from supabase status — is the local stack running?`);
  }
  let apiUrl;
  try {
    apiUrl = new URL(env.API_URL);
  } catch {
    throw new Error('local safety: API_URL is not a parseable URL — refusing');
  }
  if (!LOCAL_HOSTS.has(apiUrl.hostname) || (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:')) {
    throw new Error('local safety: API_URL host is NOT loopback — refusing to run against a non-local/hosted Supabase project');
  }
  // DB_URL contains credentials: validate its host without ever printing it.
  if (!env.DB_URL) throw new Error('local safety: missing DB_URL from supabase status');
  let dbUrl;
  try {
    dbUrl = new URL(env.DB_URL);
  } catch {
    throw new Error('local safety: DB_URL is not a parseable URL — refusing');
  }
  if (!LOCAL_HOSTS.has(dbUrl.hostname)) {
    throw new Error('local safety: DB_URL host is NOT loopback — refusing (hosted/foreign Postgres target)');
  }
  // The psql path is the dedicated local Docker db container — prove it exists and is running.
  let containers;
  try {
    containers = execSync("docker ps --format '{{.Names}}'", { encoding: 'utf8' }).split('\n');
  } catch {
    throw new Error('local safety: docker is unavailable — cannot prove the local db container');
  }
  if (!containers.includes('supabase_db_app')) {
    throw new Error('local safety: container supabase_db_app is not running — refusing (expected the dedicated local stack)');
  }
  cachedEnv = env;
  return env;
}

/** Runs the fail-closed guard; prints ONLY the non-secret marker on success. */
export function assertLocalSafety() {
  localEnv();
  console.log('API_OQ_03_LOCAL_SAFETY_CHECK=PASS');
}

export function psql(sql) {
  return execSync(
    'docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA',
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

export function psqlFile(path) {
  return execSync(
    `docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "${path}"`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: '/bin/bash' },
  );
}

export async function signIn(email, password = PASSWORD) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`signIn ${email} failed: HTTP ${res.status} (run npm run db:reset:harness first)`);
  return { token: body.access_token, refreshToken: body.refresh_token, raw: body };
}

/** PostgREST request as a signed-in user (never service-role). Client-side timed. */
export async function api(token, method, path, { headers = {}, body, timeoutMs = 30000 } = {}) {
  const { API_URL, ANON_KEY } = localEnv();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/rest/v1/${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      status: res.status,
      body: parsed,
      contentRange: res.headers.get('content-range'),
      bytes: Buffer.byteLength(text),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/**
 * Validates a PostgREST exact-count response (request with
 * `Prefer: count=exact`) and returns the exact row total.
 *
 * PostgREST answers such requests with 200 OK when the requested range
 * covers the whole result and 206 Partial Content when it does not (this
 * spike's `limit=0` count-only queries always yield 206 locally — runtime
 * evidence, run 4). BOTH are valid successes, but only jointly with a
 * well-formed Content-Range header carrying a NUMERIC total:
 *   `*\/10000` (no rows in range) or `0-999/10000` (ranged rows).
 * A wildcard/unknown total (`*`), a missing/malformed header, and any
 * other HTTP status (4xx/5xx or unexpected 2xx) fail closed.
 * The response body is NEVER consulted for the count.
 */
export function parseExactCountTotal(status, contentRange) {
  if (status !== 200 && status !== 206) {
    throw new Error(`exact-count: unexpected HTTP status ${status} (expected 200 or 206)`);
  }
  if (typeof contentRange !== 'string' || contentRange.trim() === '') {
    throw new Error(`exact-count: HTTP ${status} without a Content-Range header`);
  }
  const m = contentRange.trim().match(/^(?:\d+-\d+|\*)\/(\d+)$/);
  if (!m) {
    throw new Error(`exact-count: HTTP ${status} with malformed or non-numeric Content-Range ${JSON.stringify(contentRange)}`);
  }
  const total = Number(m[1]);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`exact-count: HTTP ${status} with invalid Content-Range total ${JSON.stringify(contentRange)}`);
  }
  return total;
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

export function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  return {
    n: times.length,
    min: +sorted[0]?.toFixed(2),
    p50: +percentile(sorted, 50)?.toFixed(2),
    p95: +percentile(sorted, 95)?.toFixed(2),
    mean: +mean.toFixed(2),
    max: +sorted[sorted.length - 1]?.toFixed(2),
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
