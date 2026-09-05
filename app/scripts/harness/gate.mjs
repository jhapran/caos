/**
 * HARNESS GATE — CI-equivalent orchestrator (verify:harness).
 *
 * Runs every currently-required Harness Gate check against the LOCAL
 * loopback-only Supabase stack and the repository's own tooling:
 *
 *   preflight → stack lifecycle → deterministic reset+seed → decision-evidence
 *   → lint → unit/component tests → Auth integration → RLS integration
 *   → schema integration → audit integration → client-hierarchy adapter contract
 *   → engagement adapter contract → Client 360 composite contract
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

  // IMP-013: audit foundation tests (TEST-AUD-* + spoofing/leakage).
  currentPhase = 'audit-integration';
  run('audit-integration', 'npm run test:audit');

  // IMP-020: client-hierarchy adapter contract against the real stack
  // (TEST-API-01…03 for the @/data client domain; schema/RLS/audit
  // coverage already runs in the phases above — not duplicated here).
  currentPhase = 'clients-integration';
  run('clients-integration', 'npm run test:clients');

  // IMP-021: engagement adapter contract against the real stack
  // (engagement service contract + billing projection; schema/RLS/audit
  // engagement coverage already runs in the phases above — not duplicated).
  currentPhase = 'engagements-integration';
  run('engagements-integration', 'npm run test:engagements');

  // IMP-022: Client 360 composite contract against the real stack
  // (TEST-API-01…03 at the composition layer + the role/no-leak matrix;
  // table-level schema/RLS/audit coverage runs in the phases above).
  currentPhase = 'client360-integration';
  run('client360-integration', 'npm run test:client360');

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
    // IMP-010 + IMP-013 + IMP-020 + IMP-021 + IMP-030 + IMP-031 + IMP-040:
    // production schema now exists. The gate distinguishes the EXPECTED
    // committed-migration tables from anything unexpected; the forbidden
    // temporary-object check above is unchanged.
    const expectedTables = [
      'audit_log', // SCH-20 (IMP-013)
      'client_compliance_profiles', // SCH-11 (IMP-031)
      'client_relationships', // SCH-06 (IMP-020)
      'clients', // SCH-04 (IMP-020)
      'compliance_instances', // SCH-12 (IMP-031)
      'compliance_rule_versions', // SCH-32 (IMP-030)
      'compliance_types', // SCH-10 (IMP-030)
      'contacts', // SCH-08 (IMP-020)
      'engagements', // SCH-09 (IMP-021)
      'firm_memberships', // SCH-03 (IMP-010)
      'firms', // SCH-01 (IMP-010)
      'legal_entities', // SCH-05 (IMP-020)
      'profiles', // SCH-02 (IMP-010)
      'registrations', // SCH-07 (IMP-020)
      'task_checklist_items', // SCH-15 (IMP-040)
      'task_comments', // SCH-16 (IMP-040)
      'task_dependencies', // SCH-14 (IMP-040)
      'tasks', // SCH-13 (IMP-040)
    ];
    const appTables = psql(
      `select coalesce(string_agg(table_name, ',' order by table_name), '')
       from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    ).trim();
    const actual = appTables ? appTables.split(',') : [];
    if (actual.join(',') !== expectedTables.join(',')) {
      throw new Error(
        `public tables are [${actual.join(',')}], expected exactly [${expectedTables.join(',')}] (committed IMP-010/013/020/021/030/031/040 migrations)`,
      );
    }
    // IMP-012/013/020/021/030/031/040: production RLS is part of the expected
    // posture — the gate fails on RLS absence/regression. The tenant-owned
    // content tables (audit_log + the five client-hierarchy tables +
    // engagements + the two compliance-rule tables + the two
    // compliance-profile/instance tables + the four task-family tables) are
    // additionally FORCED
    // (RLS-PRIN-02); the tenant core stays unforced per the IMP-012
    // documented exception (helper recursion + owner-run maintenance).
    const rlsTables = psql(
      `select coalesce(string_agg(c.relname, ',' order by c.relname), '')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`,
    ).trim();
    if (rlsTables !== expectedTables.join(',')) {
      throw new Error(`tables with RLS enabled are [${rlsTables}], expected [${expectedTables.join(',')}] (IMP-012/013/020/021/030/031/040)`);
    }
    const expectedForced = [
      'audit_log',
      'client_compliance_profiles',
      'client_relationships',
      'clients',
      'compliance_instances',
      'compliance_rule_versions',
      'compliance_types',
      'contacts',
      'engagements',
      'legal_entities',
      'registrations',
      'task_checklist_items',
      'task_comments',
      'task_dependencies',
      'tasks',
    ];
    const forcedTables = psql(
      `select coalesce(string_agg(c.relname, ',' order by c.relname), '')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`,
    ).trim();
    if (forcedTables !== expectedForced.join(',')) {
      throw new Error(`tables with FORCE RLS are [${forcedTables}], expected [${expectedForced.join(',')}] (IMP-013/020/021/030/031/040; tenant core unforced per IMP-012 exception)`);
    }
    const expectedPolicies = [
      'audit_log:audit_select_partner_admin',
      'client_compliance_profiles:ccp_insert_manager_plus',
      'client_compliance_profiles:ccp_select_scoped',
      'client_compliance_profiles:ccp_update_manager_plus',
      'client_relationships:client_relationships_insert_manager_plus',
      'client_relationships:client_relationships_select_scoped',
      'client_relationships:client_relationships_update_manager_plus',
      'clients:clients_insert_manager_plus',
      'clients:clients_select_scoped',
      'clients:clients_update_manager_plus',
      'compliance_instances:cin_insert_manager_plus',
      'compliance_instances:cin_select_scoped',
      'compliance_instances:cin_update_manager_plus',
      'compliance_rule_versions:crv_insert_privileged_aal2',
      'compliance_rule_versions:crv_select_manager_active',
      'compliance_rule_versions:crv_select_privileged',
      'compliance_rule_versions:crv_update_privileged_aal2',
      'compliance_types:compliance_types_insert_privileged_aal2',
      'compliance_types:compliance_types_select_scoped',
      'compliance_types:compliance_types_update_privileged_aal2',
      'contacts:contacts_insert_manager_plus',
      'contacts:contacts_select_scoped',
      'contacts:contacts_update_manager_plus',
      'engagements:engagements_insert_partner_plus',
      'engagements:engagements_select_scoped',
      'engagements:engagements_update_partner_plus',
      'firm_memberships:memberships_select_own_or_active_firm',
      'firms:firms_select_member',
      'firms:firms_update_super_admin',
      'legal_entities:legal_entities_insert_manager_plus',
      'legal_entities:legal_entities_select_scoped',
      'legal_entities:legal_entities_update_manager_plus',
      'profiles:profiles_select_own_or_shared_firm',
      'profiles:profiles_update_self',
      'registrations:registrations_insert_manager_plus',
      'registrations:registrations_select_scoped',
      'registrations:registrations_update_manager_plus',
      'task_checklist_items:task_checklist_items_delete_via_task',
      'task_checklist_items:task_checklist_items_insert_via_task',
      'task_checklist_items:task_checklist_items_select_via_task',
      'task_checklist_items:task_checklist_items_update_via_task',
      'task_comments:task_comments_insert_author',
      'task_comments:task_comments_select_via_task',
      'task_comments:task_comments_update_retract_author',
      'task_dependencies:task_dependencies_select_scoped',
      'tasks:tasks_insert_scoped',
      'tasks:tasks_select_scoped',
      'tasks:tasks_update_scoped',
    ];
    const policies = psql(
      `select coalesce(string_agg(tablename || ':' || policyname, ',' order by tablename || ':' || policyname), '')
       from pg_policies where schemaname = 'public'`,
    ).trim();
    if (policies !== expectedPolicies.join(',')) {
      throw new Error(`public policies are [${policies}], expected [${expectedPolicies.join(',')}] (IMP-012/013/020/021/030/031/040)`);
    }
    execSync('npm run db:verify:harness', { stdio: 'pipe' });
    return 'no hgate_/decj_/audctx_ objects; public tables = exactly tenant core + audit_log + client hierarchy + engagements + compliance rules + compliance profiles/instances + task family (committed IMP-010/013/020/021/030/031/040 migrations); RLS posture verified (RLS on all 18, FORCE on the 15 tenant-owned content tables, 48 expected policies); 16 deterministic identities verified';
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
