/**
 * IMP-004 / DEC-J spike — teardown & cleanup-acceptance verification.
 * Removes every spike object, restores supabase/config.toml, restarts the
 * stack on the loopback-bound network, and verifies the harness baseline.
 *
 * Usage: npm run spike:dec-j:cleanup
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';

import { localEnv, psql, psqlFile, restartStack, waitForStack } from './lib.mjs';

const CONFIG = 'supabase/config.toml';
const CONFIG_BAK = 'scripts/spikes/dec-j/config.toml.bak';

const out = { status: 'ok', checks: {} };
const fail = (name, detail) => {
  out.status = 'error';
  out.checks[name] = { ok: false, detail };
  console.error(`FAIL ${name}: ${detail}`);
};
const pass = (name, detail) => {
  out.checks[name] = { ok: true, detail };
  console.log(`ok   ${name}: ${detail}`);
};

console.log('== DEC-J spike teardown ==');

// 1. Restore config.toml (disable the custom access-token hook)
if (existsSync(CONFIG_BAK)) {
  copyFileSync(CONFIG_BAK, CONFIG);
  rmSync(CONFIG_BAK);
  pass('config.toml restored from pre-spike backup', CONFIG);
} else if (readFileSync(CONFIG, 'utf8').includes('decj_access_token_hook')) {
  fail('config.toml restore', 'no backup found but hook block still present — manual edit required');
} else {
  pass('config.toml clean', 'no hook block present');
}

// 2. Drop spike objects
psqlFile('scripts/spikes/dec-j/teardown.sql');
pass('teardown.sql applied', 'spike tables/functions/policies dropped');

// 3. Restart stack (hook config change) and wait healthy
restartStack();
await waitForStack();
pass('stack restarted', 'auth + rest healthy');

// 4. Cleanup acceptance checks
const tables = psql(
  `select coalesce(string_agg(table_name,','),'') from information_schema.tables where table_schema='public' and table_name like 'decj%'`,
);
if (tables.trim() === '') pass('decj_* tables removed', 'none remain');
else fail('decj_* tables removed', `remaining: ${tables}`);

const funcs = psql(
  `select coalesce(string_agg(proname,','),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'decj%'`,
);
if (funcs.trim() === '') pass('decj_* functions removed', 'none remain');
else fail('decj_* functions removed', `remaining: ${funcs}`);

const pols = psql(`select coalesce(string_agg(policyname,','),'') from pg_policies where policyname like 'decj%'`);
if (pols.trim() === '') pass('decj_* policies removed', 'none remain');
else fail('decj_* policies removed', `remaining: ${pols}`);

const publicCount = Number(
  psql(`select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`).trim(),
);
if (publicCount === 0) pass('public R0 application table count', '0');
else fail('public R0 application table count', `expected 0, got ${publicCount}`);

// 5. Harness users still verify
const { execSync } = await import('node:child_process');
try {
  execSync('npm run db:verify:harness', { stdio: 'pipe' });
  pass('harness users verify', '16/16 deterministic identities intact');
} catch {
  fail('harness users verify', 'db:verify:harness failed');
}

// 6. Loopback-only bindings
const listeners = execSync("ss -ltn | grep -E '5432[1-7]' | awk '{print $4}' | sort -u", { encoding: 'utf8', shell: '/bin/bash' })
  .trim()
  .split('\n');
if (listeners.length > 0 && listeners.every((l) => l.startsWith('127.0.0.1:'))) {
  pass('loopback-only port bindings', listeners.join(' '));
} else {
  fail('loopback-only port bindings', listeners.join(' '));
}

// 7. Local MCP still initializes
try {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'decj-teardown', version: '0' } },
    }),
  });
  const body = await res.json();
  if (body.result?.serverInfo?.name === 'supabase') pass('local MCP initialize', body.result.serverInfo.name);
  else fail('local MCP initialize', JSON.stringify(body).slice(0, 120));
} catch (e) {
  fail('local MCP initialize', e.message);
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.status === 'ok' ? 0 : 1);
