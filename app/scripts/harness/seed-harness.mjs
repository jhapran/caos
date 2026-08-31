#!/usr/bin/env node
/**
 * IMP-003 — Deterministic LOCAL HARNESS seed (Supabase Auth users only).
 *
 * Source of truth for identities: tests/harness/registry.json
 *
 * Properties:
 *  - Uses the supported GoTrue Auth Admin API against the RUNNING LOCAL
 *    stack. No direct auth.users/auth.identities schema writes.
 *  - Discovers API_URL and SERVICE_ROLE_KEY dynamically from
 *    `supabase status -o env`. No credentials are committed.
 *  - Idempotent: existing users with the expected (email, id) pair are
 *    treated as success. A matching email with a DIFFERENT id is a loud
 *    failure — fixtures are never silently mutated.
 *  - --check mode verifies only (no creation).
 *
 * This is local test/harness infrastructure (MIG-SEED-06, TEST-MIG-10).
 * It is NOT production seed data and must never run against hosted
 * Supabase (it hard-refuses non-local API URLs).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const checkOnly = process.argv.includes('--check');

const registry = JSON.parse(
  readFileSync(new URL('../../tests/harness/registry.json', import.meta.url), 'utf8'),
);

function localEnv() {
  const out = execSync('npx supabase status -o env', { encoding: 'utf8' });
  const env = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="(.*)"$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.API_URL || !env.SERVICE_ROLE_KEY) {
    throw new Error(
      'Could not discover API_URL/SERVICE_ROLE_KEY from `supabase status -o env`. Is the local stack running (npm run db:start)?',
    );
  }
  return env;
}

const { API_URL, SERVICE_ROLE_KEY } = localEnv();

// Hard safety: harness seeding is local-only, never hosted/production.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL)) {
  console.error(
    JSON.stringify({ status: 'error', error: `Refusing to seed non-local Supabase: ${API_URL}` }, null, 2),
  );
  process.exit(1);
}

const adminHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function listUsers() {
  const res = await fetch(`${API_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: adminHeaders,
  });
  if (!res.ok) throw new Error(`list users failed: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.users ?? [];
}

async function createUser(key, persona) {
  const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      id: persona.id,
      email: persona.email,
      password: registry.passwordLocalOnly,
      email_confirm: true,
      user_metadata: { harness_fixture: true, harness_persona: key },
    }),
  });
  if (!res.ok) throw new Error(`create ${persona.email} failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const expected = Object.entries(registry.users);
const result = {
  status: 'ok',
  mode: checkOnly ? 'check' : 'seed',
  expected: expected.length,
  created: 0,
  alreadyPresent: 0,
  verified: 0,
  errors: [],
  warnings: [],
};

// 1) Seed (skipped in --check mode).
if (!checkOnly) {
  const existing = await listUsers();
  const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));
  for (const [key, persona] of expected) {
    const found = byEmail.get(persona.email.toLowerCase());
    if (!found) {
      const created = await createUser(key, persona);
      if (created.id !== persona.id) {
        result.errors.push(
          `${key}: created user ${persona.email} but server returned id ${created.id}, expected ${persona.id}`,
        );
      } else {
        result.created += 1;
      }
      continue;
    }
    if (found.id !== persona.id) {
      result.errors.push(
        `${key}: email ${persona.email} already exists with id ${found.id}, expected ${persona.id}. NOT mutating — resolve manually.`,
      );
      continue;
    }
    result.alreadyPresent += 1;
  }
}

// 2) Verify.
const after = await listUsers();
const emailCounts = new Map();
for (const u of after) {
  const e = u.email.toLowerCase();
  emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
}
const expectedEmails = new Set(expected.map(([, p]) => p.email.toLowerCase()));

for (const [email, count] of emailCounts) {
  if (count > 1) result.errors.push(`duplicate auth users for email ${email}: ${count}`);
}
for (const u of after) {
  if (!expectedEmails.has(u.email.toLowerCase())) {
    result.warnings.push(`unexpected auth user present: ${u.email} (${u.id})`);
  }
}
for (const [key, persona] of expected) {
  const matches = after.filter((u) => u.email.toLowerCase() === persona.email.toLowerCase());
  if (matches.length === 0) {
    result.errors.push(`${key}: expected user ${persona.email} missing`);
    continue;
  }
  if (matches.length === 1 && matches[0].id === persona.id) result.verified += 1;
}

if (result.errors.length > 0) result.status = 'error';
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'ok' ? 0 : 1);
