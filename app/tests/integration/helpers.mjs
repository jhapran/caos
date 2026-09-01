/**
 * Harness Gate integration-test helpers. LOCAL Supabase only; no committed
 * secrets — privileged local credentials are discovered dynamically from the
 * running stack and never written to disk.
 */
import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
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

// ---------------------------------------------------------------------------
// IMP-011 — staff-auth integration helpers (local GoTrue + Mailpit only)
// ---------------------------------------------------------------------------

const MAILPIT_URL = 'http://127.0.0.1:54324';

function adminHeaders() {
  const { SERVICE_ROLE_KEY } = localEnv();
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Admin API (test setup/teardown only — never the request under test). */
export async function adminCreateUser(email, password, metadata = {}) {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`adminCreateUser failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

export async function adminDeleteUser(id) {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`adminDeleteUser failed: HTTP ${res.status} ${await res.text()}`);
  }
}

/**
 * Idempotent teardown helper: delete an auth user by email if one exists.
 * Looks the id up via psql (service-side) then deletes through the admin
 * API so sessions/identities/factors are cleaned up properly. Keeps
 * integration files re-runnable after a previously failed/partial run.
 */
export async function deleteUserByEmail(email) {
  const id = psql(`select id from auth.users where email = '${email}'`).trim();
  if (id) await adminDeleteUser(id);
  return id || null;
}

export async function adminUpdateUser(id, patch) {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

export async function adminGenerateLink(type, email, options = {}) {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ type, email, ...options }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`adminGenerateLink(${type}) failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body; // { hashed_token, action_link, ... }
}

export async function adminListFactors(userId) {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/users/${userId}/factors`, {
    headers: adminHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`adminListFactors failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body.factors ?? body;
}

export async function adminDeleteFactor(userId, factorId) {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/admin/users/${userId}/factors/${factorId}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(`adminDeleteFactor failed: HTTP ${res.status} ${await res.text()}`);
}

/** Public endpoints exercised as a browser would (anon key only). */
export async function authPost(path, body, token) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed };
}

export async function authPutUser(token, patch) {
  const { API_URL, ANON_KEY } = localEnv();
  const res = await fetch(`${API_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Wait for the latest verify email to `email` in local Mailpit and extract
 *  the token/type from the /auth/v1/verify link. */
export async function mailpitVerifyLink(email, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
    const list = await res.json();
    const msg = (list.messages ?? []).find((m) =>
      (m.To ?? []).some((t) => t.Address.toLowerCase() === email.toLowerCase()),
    );
    if (msg) {
      const full = await (await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`)).json();
      const body = `${full.Text ?? ''} ${full.HTML ?? ''}`;
      const m = body.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
      if (m) {
        const url = new URL(m[0].replace(/&amp;/g, '&'));
        return { tokenHash: url.searchParams.get('token'), type: url.searchParams.get('type') };
      }
    }
    if (Date.now() > deadline) throw new Error(`no verify email for ${email} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret — test-only. */
export function totpCode(secret, offsetSteps = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const key = Buffer.from(out);
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
  return code;
}
