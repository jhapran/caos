/**
 * IMP-005 / AUDIT-CONTEXT SPIKE — teardown & cleanup-acceptance verification.
 * Removes every audctx_* object and verifies the harness baseline.
 *
 * Usage: npm run spike:audit-context:cleanup
 */
import { execSync } from 'node:child_process';

import { localEnv, psql, psqlFile } from '../dec-j/lib.mjs';

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

console.log('== AUDIT-CONTEXT spike teardown ==');

// 1. Drop spike objects
psqlFile('scripts/spikes/audit-context/teardown.sql');
pass('teardown.sql applied', 'spike tables/functions/policies/trigger dropped');

// 2. Cleanup acceptance checks
const tables = psql(
  `select coalesce(string_agg(table_name,','),'') from information_schema.tables where table_schema='public' and table_name like 'audctx%'`,
);
if (tables.trim() === '') pass('audctx_* tables removed', 'none remain');
else fail('audctx_* tables removed', `remaining: ${tables}`);

const funcs = psql(
  `select coalesce(string_agg(proname,','),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'audctx%'`,
);
if (funcs.trim() === '') pass('audctx_* functions removed', 'none remain');
else fail('audctx_* functions removed', `remaining: ${funcs}`);

const appTables = psql(
  `select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`,
);
if (appTables.trim() === '0') pass('public application-table count', '0 (R0 schema untouched)');
else fail('public application-table count', `expected 0, got ${appTables.trim()}`);

// 3. Deterministic harness still intact
try {
  execSync('npm run db:verify:harness', { stdio: 'pipe' });
  pass('harness verification', '16 deterministic identities intact');
} catch (e) {
  fail('harness verification', e.message);
}

// 4. Local MCP still initializes (loopback only)
try {
  const { API_URL } = localEnv();
  const res = await fetch(`${API_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'audctx-teardown-check', version: '0.0.0' },
      },
    }),
  });
  if (res.ok) pass('local MCP initialize', `HTTP ${res.status} (loopback)`);
  else fail('local MCP initialize', `HTTP ${res.status}`);
} catch (e) {
  fail('local MCP initialize', e.message);
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.status === 'ok' ? 0 : 1);
