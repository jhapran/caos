/**
 * Harness Gate integration-test helpers. LOCAL Supabase only; no committed
 * secrets — privileged local credentials are discovered dynamically from the
 * running stack and never written to disk.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const REGISTRY = JSON.parse(
  readFileSync(new URL('../../tests/harness/registry.json', import.meta.url), 'utf8'),
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

let cachedEnv = null;
export function localEnv() {
  if (cachedEnv) return cachedEnv;
  const out = execSync('npx supabase status -o env', { encoding: 'utf8' });
  const env = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="(.*)"$/);
    if (m) env[m[1]] = m[2];
  }
  for (const k of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET']) {
    if (!env[k]) throw new Error(`missing ${k} from supabase status — is the local stack running?`);
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.API_URL)) {
    throw new Error(`refusing to run integration tests against non-local Supabase: ${env.API_URL}`);
  }
  cachedEnv = env;
  return env;
}

/** Admin/test-setup SQL only (docker exec psql as postgres). Never used for
 *  the request whose RLS behavior is under test. */
export function psql(sql) {
  return execSync(
    'docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA',
    { input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

export function psqlFile(path) {
  return execSync(
    `docker exec -i supabase_db_app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "${path}"`,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: '/bin/bash' },
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
  return { ok: res.ok, status: res.status, token: body.access_token, refreshToken: body.refresh_token, raw: body };
}

export async function refreshSession(refreshToken) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, token: body.access_token, refreshToken: body.refresh_token, raw: body };
}

export async function getUser(token) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function logout(token) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return { status: res.status };
}

/** PostgREST request as a signed-in user (never service-role). */
export async function api(token, method, path, { headers = {}, body } = {}) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, contentRange: res.headers.get('content-range') };
}

export function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
