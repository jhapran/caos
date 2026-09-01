/**
 * IMP-004 / DEC-J spike — shared helpers. Local-only; no committed secrets.
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
    throw new Error(`refusing to run spike against non-local Supabase: ${env.API_URL}`);
  }
  cachedEnv = env;
  return env;
}

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
  if (!res.ok) throw new Error(`signIn ${email} failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return { token: body.access_token, refreshToken: body.refresh_token, raw: body };
}

export async function refreshSession(refreshToken) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return { token: body.access_token, refreshToken: body.refresh_token, raw: body };
}

export async function adminUpdateUser(id, appMetadata) {
  const { API_URL, SERVICE_ROLE_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ app_metadata: appMetadata }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`adminUpdateUser failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
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

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForStack(timeoutMs = 120000) {
  const { API_URL } = localEnv();
  const start = Date.now();
  for (;;) {
    try {
      const auth = await fetch(`${API_URL}/auth/v1/health`);
      const rest = await fetch(`${API_URL}/rest/v1/`);
      if (auth.ok && rest.ok) return;
    } catch {
      /* not ready */
    }
    if (Date.now() - start > timeoutMs) throw new Error('stack did not become healthy in time');
    await sleep(2000);
  }
}

export function restartStack() {
  execSync('npm run db:stop', { stdio: 'inherit' });
  execSync('npm run db:start', { stdio: 'inherit' });
}
