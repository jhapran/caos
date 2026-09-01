/**
 * HARNESS GATE — CI-equivalent orchestrator (verify:harness).
 *
 * Runs every currently-required Harness Gate check against the LOCAL
 * loopback-only Supabase stack and the repository's own tooling:
 *
 *   preflight → stack lifecycle → deterministic reset+seed → decision-evidence
 *   → lint → unit/component tests → Auth integration → RLS integration
 *   → production build → Playwright smoke → network-binding security gate
 *   → MCP regression → database cleanliness + harness verification
 *   → secret scan (TEST-SEC-01 harness level) → summary
 *
 * Fails fast on the first failed required phase (non-zero exit, phase named),
 * still attempting safe fixture cleanup and stack-lifecycle restoration.
 * Never uses bare `supabase start` — always the loopback-bound db:start.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

import { localEnv, psql, psqlFile } from '../../tests/integration/helpers.mjs';

const result = {
  gate: 'CAOS Harness Gate (verify:harness)',
  startedAt: new Date().toISOString(),
  phases: [],
  status: 'PASS',
};
let stackStartedByGate = false;
let currentPhase = 'init';

function record(name, ok, detail, durationMs) {
  result.phases.push({ name, ok, detail, durationMs: Math.round(durationMs) });
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${name}] ${detail} (${Math.round(durationMs)} ms)`);
}

function run(name, cmd, { shell = true } = {}) {
  const t0 = performance.now();
  const r = spawnSync(cmd, { shell, stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  const tail = (r.stdout || '').trim().split('\n').slice(-3).join(' | ');
  const errTail = (r.stderr || '').trim().split('\n').slice(-3).join(' | ');
  record(name, ok, ok ? tail || 'passed' : `exit ${r.status}: ${errTail || tail}`, performance.now() - t0);
  if (!ok) {
    console.log(r.stdout || '');
    console.error(r.stderr || '');
    throw new Error(`phase failed: ${name}`);
  }
}

function check(name, fn) {
  const t0 = performance.now();
  try {
    const detail = fn();
    record(name, true, detail, performance.now() - t0);
  } catch (e) {
    record(name, false, e.message, performance.now() - t0);
    throw new Error(`phase failed: ${name}: ${e.message}`);
  }
}

function cleanupAfterFailure() {
  console.error('\n!! gate failed during phase:', currentPhase, '— attempting safe cleanup');
  try {
    psqlFile('tests/integration/rls/teardown.sql');
    console.error('   hgate_* teardown applied');
  } catch {
    /* stack may be down or objects absent */
  }
  if (stackStartedByGate) {
    try {
      execSync('npm run db:stop', { stdio: 'inherit' });
      console.error('   local stack stopped (was started by gate)');
    } catch {
      /* best effort */
    }
  }
}

function stackIsRunning() {
  try {
    execSync('npx supabase status -o env', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
async function main() {
  currentPhase = 'preflight';
  check('preflight', () => {
    const node = process.version;
    if (Number(node.slice(1).split('.')[0]) < 20) throw new Error(`node >= 20 required, got ${node}`);
    execSync('docker info', { stdio: 'pipe' });
    execSync('npx supabase --version', { stdio: 'pipe' });
    if (!existsSync(`${process.env.HOME}/.cache/ms-playwright`)) {
      throw new Error('playwright browsers missing — run: npx playwright install chromium');
    }
    for (const f of [
      'docs/harness/dec-j-spike.md',
      'docs/harness/dec-j-results.json',
      'docs/harness/audit-context-spike.md',
      'docs/harness/audit-context-results.json',
      'tests/harness/registry.json',
    ]) {
      if (!existsSync(f)) throw new Error(`missing evidence file: ${f}`);
    }
    return `node ${node}, docker ok, supabase CLI ok, decision evidence present`;
  });

  currentPhase = 'stack-lifecycle';
  check('stack-lifecycle', () => {
    if (stackIsRunning()) return 'stack already running — will be left running afterwards';
    execSync('npm run db:start', { stdio: 'inherit' });
    stackStartedByGate = true;
    return 'stack started by gate via db:start (loopback network) — will be stopped afterwards';
  });

  currentPhase = 'db-reset-seed';
  run('db-reset-seed', 'npm run db:reset:harness');

  currentPhase = 'decision-evidence';
  check('decision-evidence', () => {
    const spec05 = execSync('grep -c "RESOLVED (2026-09-01)" docs/spec/05-authorization-rls.md', { encoding: 'utf8' }).trim();
    const spec08 = execSync('grep -c "RESOLVED 2026-09-01" docs/spec/08-audit-security.md', { encoding: 'utf8' }).trim();
    if (spec05 === '0') throw new Error('DEC-J resolution not found in spec 05');
    if (spec08 === '0') throw new Error('AUD-OQ-02 resolution not found in spec 08');
    return 'DEC-J = live membership lookup (05); AUD-OQ-02 = layered A+B+C (08); spike evidence committed';
  });

  currentPhase = 'lint';
  run('lint', 'npm run lint');

  currentPhase = 'unit-tests';
  run('unit-tests', 'npm run test:unit');

  currentPhase = 'auth-integration';
  run('auth-integration', 'npm run test:auth');

  currentPhase = 'rls-integration';
  run('rls-integration', 'npm run test:rls');

  // IMP-010: tenant-core schema tests (TEST-SCH-02/03 + structural).
  currentPhase = 'schema-integration';
  run('schema-integration', 'npm run test:schema');

  currentPhase = 'build';
  run('build', 'npm run build');

  currentPhase = 'playwright-smoke';
  run('playwright-smoke', 'npm run test:e2e');

  currentPhase = 'network-binding';
  check('network-binding', () => {
    const out = execSync("docker ps --filter name=supabase_ --format '{{.Names}} {{.Ports}}'", { encoding: 'utf8' });
    const bad = [];
    for (const line of out.split('\n')) {
      for (const m of line.matchAll(/(?:0\.0\.0\.0|\[::\]|::):(\d+)->/g)) {
        bad.push(`${line.split(' ')[0]}:${m[1]}`);
      }
    }
    if (bad.length) throw new Error(`Supabase ports published externally: ${bad.join(', ')}`);
    const ss = execSync('ss -ltn', { encoding: 'utf8' });
    const exposed = ss.split('\n').filter((l) => {
      const m = l.match(/(\S+):5432\d\s/);
      return m && !m[1].endsWith('127.0.0.1') && m[1] !== '[::1]' && m[1] !== '*';
    }).filter((l) => /(^|\s)(0\.0\.0\.0|\[::\]|::):5432\d/.test(l));
    if (exposed.length) throw new Error(`non-loopback listeners in Supabase port range:\n${exposed.join('\n')}`);
    return 'all published Supabase services bound to 127.0.0.1 (docker + ss verified)';
  });

  currentPhase = 'mcp-regression';
  await (async () => {
    const t0 = performance.now();
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
            clientInfo: { name: 'harness-gate', version: '0.0.0' },
          },
        }),
      });
      record('mcp-regression', res.ok, `local MCP initialize HTTP ${res.status} (loopback)`, performance.now() - t0);
      if (!res.ok) throw new Error('MCP initialize failed');
    } catch (e) {
      record('mcp-regression', false, e.message, performance.now() - t0);
      throw new Error(`phase failed: mcp-regression: ${e.message}`);
    }
  })();

  currentPhase = 'db-cleanliness';
  check('db-cleanliness', () => {
    const stray = psql(
      `select string_agg(table_name, ',') from information_schema.tables
       where table_schema = 'public' and (table_name like 'hgate%' or table_name like 'decj%' or table_name like 'audctx%')`,
    ).trim();
    if (stray) throw new Error(`stray harness/spike tables remain: ${stray}`);
    // IMP-010: production schema now exists. The gate distinguishes the
    // EXPECTED committed-migration tables from anything unexpected; the
    // forbidden temporary-object check above is unchanged.
    const expectedTables = ['firm_memberships', 'firms', 'profiles']; // IMP-010 tenant core (SCH-01…03)
    const appTables = psql(
      `select coalesce(string_agg(table_name, ',' order by table_name), '')
       from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    ).trim();
    const actual = appTables ? appTables.split(',') : [];
    if (actual.join(',') !== expectedTables.join(',')) {
      throw new Error(
        `public tables are [${actual.join(',')}], expected exactly [${expectedTables.join(',')}] (committed IMP-010 migrations)`,
      );
    }
    // IMP-012: foundational production RLS is now part of the expected
    // posture — the gate fails on RLS absence/regression on the tenant core.
    const rlsTables = psql(
      `select coalesce(string_agg(c.relname, ',' order by c.relname), '')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
    ).trim();
    if (rlsTables !== expectedTables.join(',')) {
      throw new Error(`tables with RLS enabled are [${rlsTables}], expected [${expectedTables.join(',')}] (IMP-012)`);
    }
    const expectedPolicies = [
      'firm_memberships:memberships_insert_super_admin_aal2',
      'firm_memberships:memberships_select_own_or_active_firm',
      'firm_memberships:memberships_update_super_admin_aal2',
      'firms:firms_select_member',
      'firms:firms_update_super_admin',
      'profiles:profiles_select_own_or_shared_firm',
      'profiles:profiles_update_self',
    ];
    const policies = psql(
      `select coalesce(string_agg(tablename || ':' || policyname, ',' order by tablename || ':' || policyname), '')
       from pg_policies where schemaname = 'public'`,
    ).trim();
    if (policies !== expectedPolicies.join(',')) {
      throw new Error(`public policies are [${policies}], expected [${expectedPolicies.join(',')}] (IMP-012)`);
    }
    execSync('npm run db:verify:harness', { stdio: 'pipe' });
    return 'no hgate_/decj_/audctx_ objects; public tables = exactly IMP-010 tenant core (firms, profiles, firm_memberships); IMP-012 RLS posture verified (RLS enabled on all 3, 7 expected policies); 16 deterministic identities verified';
  });

  currentPhase = 'secret-scan';
  check('secret-scan', () => {
    const { SERVICE_ROLE_KEY, JWT_SECRET } = localEnv();
    for (const [label, secret] of [['SERVICE_ROLE_KEY', SERVICE_ROLE_KEY], ['JWT_SECRET', JWT_SECRET]]) {
      const found = spawnSync('git', ['grep', '-F', '-l', secret, '--', '.'], { encoding: 'utf8' });
      if (found.status === 0 && found.stdout.trim()) {
        throw new Error(`${label} value found in tracked files: ${found.stdout.trim()}`);
      }
      if (existsSync('dist')) {
        const dist = spawnSync('grep', ['-rF', '-l', secret, 'dist/'], { encoding: 'utf8' });
        if (dist.status === 0 && dist.stdout.trim()) {
          throw new Error(`${label} value found in build output: ${dist.stdout.trim()}`);
        }
      }
    }
    return 'no service-role key or JWT secret in tracked files or dist/ (TEST-SEC-01 harness level)';
  });

  if (stackStartedByGate) {
    currentPhase = 'stack-stop';
    run('stack-stop', 'npm run db:stop');
  }

  result.finishedAt = new Date().toISOString();
  writeFileSync('docs/harness/harness-gate-result.json', JSON.stringify(result, null, 2));
  const total = result.phases.length;
  console.log(`\n== HARNESS GATE CANDIDATE: PASS — ${total}/${total} phases green ==`);
  console.log('machine evidence -> docs/harness/harness-gate-result.json');
}

main().catch((e) => {
  console.error(`\n== HARNESS GATE CANDIDATE: FAIL — ${e.message} ==`);
  result.status = 'FAIL';
  result.failedPhase = currentPhase;
  result.finishedAt = new Date().toISOString();
  try {
    writeFileSync('docs/harness/harness-gate-result.json', JSON.stringify(result, null, 2));
  } catch {
    /* best effort */
  }
  cleanupAfterFailure();
  process.exit(1);
});
