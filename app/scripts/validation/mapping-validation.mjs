/**
 * IMP-070 — Fixture → production mapping validation tooling.
 *
 * Governing IDs: IMP-070, TEST-MIG (TEST-MIG-01…15 dispositions),
 * MIG-ACC-03 (unsupported-export vocabulary), MIG-VAL-03 (adapter parity
 * evidence), API-INV-01 (docs/spec/07-api-contract.md export
 * classification), and the docs/spec/10-migration-seed.md fixture →
 * production mapping table.
 *
 * Purpose:
 *  1. Statically enumerate EVERY export reachable from the data-layer
 *     barrel src/data/index.ts (regex parse only — no TS compiler, no
 *     module execution).
 *  2. Classify every enumerated export against an embedded registry that
 *     is the executable encoding of API-INV-01 (KEEP / EVOLVE / REPLACE /
 *     DEMO-ONLY) and the spec-10 mapping table (DIRECT_SYNTHETIC /
 *     TRANSFORM / REFERENCE_SEED / DEMO_ONLY / FIXTURE_ONLY_PRESENTATION /
 *     NOT_DATA).
 *  3. Fail closed (exit 1) on any unclassified export, any stale registry
 *     entry, any spec-class mismatch, or any 'unsupported' classification.
 *  4. Generate docs/mapping-validation-report.md (--write-report) and
 *     guard it against hand-edits / drift (--check-report).
 *
 * Usage (run with cwd = app/):
 *   node scripts/validation/mapping-validation.mjs                validate, print JSON, exit 0/1
 *   node scripts/validation/mapping-validation.mjs --write-report validate, then regenerate the report
 *   node scripts/validation/mapping-validation.mjs --check-report validate AND fail if the committed report drifts
 *
 * Properties:
 *  - Node built-ins only; no package dependencies; no network access.
 *  - No clock dependence and no environment reads: output is deterministic
 *    (stable sorted ordering) and byte-stable across runs and machines.
 *  - The committed report contains no timestamps, no absolute paths, and
 *    no environment values.
 *  - Safety: read-only except for --write-report regenerating the one
 *    report file under docs/. No secrets, no customer data — export
 *    classifications only.
 *
 * Result contract: structured JSON printed via
 * console.log(JSON.stringify(result, null, 2)); diagnostics to
 * console.error; exit 0 on PASS, 1 on FAIL.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BARREL = 'src/data/index.ts';
const REPORT_PATH = 'docs/mapping-validation-report.md';
const GENERATOR_CMD = 'node scripts/validation/mapping-validation.mjs --write-report';

const API_INV_CLASSES = ['KEEP', 'EVOLVE', 'REPLACE', 'DEMO-ONLY'];
const MAPPING_CLASSES = [
  'DIRECT_SYNTHETIC',
  'TRANSFORM',
  'REFERENCE_SEED',
  'DEMO_ONLY',
  'FIXTURE_ONLY_PRESENTATION',
  'NOT_DATA',
];

const PRODUCTION_NOTE =
  'production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface';
const FIXTURE_TYPE_NOTE = 'fixture-era domain type; production domain model is docs/spec/02';
const DEMO_STORE_NOTE = 'fixture demo overlay store — demo mode only';
const HELPER_NOTE = 'fixture computation helper — logic re-implemented server-side from due_rule data';

// ---------------------------------------------------------------------------
// Step 1 — barrel export enumeration (static regex parse, deterministic).
// ---------------------------------------------------------------------------

/** Strip // and /* *\/ comments while preserving string/template contents. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = 'string';
        quote = c;
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
    } else if (state === 'line') {
      if (c === '\n') {
        out += '\n';
        state = 'code';
      }
      i += 1;
    } else if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (c === '\n') out += '\n';
      i += 1;
    } else {
      if (c === '\\') {
        out += c + (d === undefined ? '' : d);
        i += 2;
        continue;
      }
      out += c;
      i += 1;
      if (c === quote) state = 'code';
    }
  }
  return out;
}

/** Resolve a './x' specifier relative to a module file, file-first (.ts, .tsx, /index.ts, /index.tsx). */
function resolveModule(spec, fromFile) {
  const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const base = `${dir}/${spec.slice(2)}`;
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(cand)) return cand;
  }
  throw new Error(`unresolvable module specifier '${spec}' referenced from ${fromFile}`);
}

/** Parse the export-bearing statements of one module file. */
function parseModuleExports(file) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const own = [];
  const locals = [];
  const reexports = [];
  const stars = [];
  let m;
  const starRe = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = starRe.exec(src)) !== null) stars.push(m[1]);
  const reexportRe = /export\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = reexportRe.exec(src)) !== null) {
    reexports.push({ allType: Boolean(m[1]), body: m[2], spec: m[3] });
  }
  const localRe = /export\s+(type\s+)?\{([\s\S]*?)\}(?!\s*from)/g;
  while ((m = localRe.exec(src)) !== null) {
    locals.push({ allType: Boolean(m[1]), body: m[2] });
  }
  const declRe =
    /export\s+(?:declare\s+)?(const|let|var|function|async\s+function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(src)) !== null) {
    const kind = m[1] === 'interface' || m[1] === 'type' ? 'type' : 'value';
    own.push({ name: m[2], kind });
  }
  return { own, locals, reexports, stars };
}

/** Parse the inside of an `export { A, B as C, type D }` name list (multi-line safe). */
function parseNameList(body, allType) {
  const out = [];
  for (const rawPart of body.split(',')) {
    let part = rawPart.trim();
    if (!part) continue;
    let kind = allType ? 'type' : 'value';
    if (part.startsWith('type ')) {
      kind = 'type';
      part = part.slice(5).trim();
    }
    const segments = part.split(/\s+as\s+/);
    const name = (segments.length > 1 ? segments[segments.length - 1] : segments[0]).trim();
    if (name) out.push({ name, kind });
  }
  return out;
}

/**
 * Enumerate every export reachable from the barrel: named re-exports,
 * type re-exports, and depth-first cycle-safe recursion through
 * `export * from './x'`. Returns rows sorted by name (code-unit order).
 */
function enumerateBarrel(barrelPath) {
  const found = new Map();
  const visited = new Set();
  const add = (name, kind, source) => {
    if (!found.has(name)) found.set(name, { name, kind, source });
  };
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const { own, locals, reexports, stars } = parseModuleExports(file);
    for (const d of own) add(d.name, d.kind, file);
    for (const l of locals) {
      for (const e of parseNameList(l.body, l.allType)) add(e.name, e.kind, file);
    }
    for (const r of reexports) {
      const target = resolveModule(r.spec, file);
      for (const e of parseNameList(r.body, r.allType)) add(e.name, e.kind, target);
    }
    for (const spec of stars) visit(resolveModule(spec, file));
  };
  visit(barrelPath);
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Step 2 — embedded classification registry.
// ---------------------------------------------------------------------------

/** Fixture-era source modules: exports from these MUST be explicitly classified. */
const FIXTURE_MODULE_PATHS = new Set([
  'src/data/types.ts',
  'src/data/clients.ts',
  'src/data/compliance.ts',
  'src/data/tasks.ts',
  'src/data/deadlines.ts',
  'src/data/review.ts',
  'src/data/alerts.ts',
  'src/data/dependency.ts',
  'src/data/askCaos.ts',
  'src/data/api.ts',
  'src/data/store.tsx',
]);

/** Fixture-era value/function exports (API-INV-01, docs/spec/07-api-contract.md). */
const FIXTURE_VALUE_REGISTRY = [
  // EVOLVE — same UI-facing contract, new production implementation.
  { name: 'fetchClients', apiInv: 'EVOLVE', note: 'clients read under RLS-CLI-01; paginated; offboarded excluded by default (DM-04)' },
  { name: 'getClients', apiInv: 'EVOLVE', note: 'sync twin of fetchClients; same evolved production read' },
  { name: 'fetchClient', apiInv: 'EVOLVE', note: 'Client 360 composite read (DM-X-02): one contract, several underlying reads' },
  { name: 'fetchTasks', apiInv: 'EVOLVE', note: 'tasks read (RLS-TSK-01) with declared filters; paginated' },
  { name: 'getTasks', apiInv: 'EVOLVE', note: 'sync twin of fetchTasks; same evolved production read' },
  { name: 'getTasksForClient', apiInv: 'EVOLVE', note: 'tasks read filtered by client (RLS-TSK-01)' },
  { name: 'fetchTask', apiInv: 'EVOLVE', note: 'task + checklist + comments + dependencies read (SCH-13…16)' },
  { name: 'fetchDeadlines', apiInv: 'EVOLVE', note: 'server-derived board over compliance_instances (SCH-12); grouping computed server-side' },
  { name: 'getDeadlineGroups', apiInv: 'EVOLVE', note: 'sync twin of fetchDeadlines; same evolved production read' },
  { name: 'fetchDeadline', apiInv: 'EVOLVE', note: 'same read model, single group' },
  { name: 'getDeadlineGroup', apiInv: 'EVOLVE', note: 'sync twin of fetchDeadline; same evolved production read' },
  { name: 'fetchDeadlineClients', apiInv: 'EVOLVE', note: 'instance rows for the group with client/entity/assignee projection' },
  { name: 'getDeadlineClients', apiInv: 'EVOLVE', note: 'sync twin of fetchDeadlineClients; same evolved production read' },
  { name: 'fetchComplianceTasks', apiInv: 'EVOLVE', note: 'instances + tasks for one compliance_type (SCH-12 drill-down index)' },
  { name: 'getTasksForCompliance', apiInv: 'EVOLVE', note: 'sync twin of fetchComplianceTasks; same evolved production read' },
  { name: 'fetchReviewItems', apiInv: 'EVOLVE', note: 'review_items read (RLS-RVW-01); queue view per role; realtime per API-RT-01' },
  { name: 'fetchAlerts', apiInv: 'EVOLVE', note: 'alerts read (RLS-ALR-01); realtime per API-RT-01' },
  { name: 'getFirm', apiInv: 'EVOLVE', note: 'firms read (RLS-FRM-01); settings write is an admin RPC (RLS-AAL-01)' },
  { name: 'getTeam', apiInv: 'EVOLVE', note: 'firm_memberships ⋈ profiles read (RLS-MEM-01/RLS-PRF-01)' },
  { name: 'getComplianceMaster', apiInv: 'EVOLVE', note: 'merged view: system defaults + firm overrides shadowing per TEN-07 (RLS-CTY-01)' },
  // REPLACE — retired; function absorbed by a different production contract.
  { name: 'getAggregates', apiInv: 'REPLACE', note: 'live counters via the API-R0-DASH B-count read model (API-OQ-03 resolved); fixture AGGREGATES has no production counterpart (DM-X-03)' },
  { name: 'fetchAggregates', apiInv: 'REPLACE', note: 'live counters via the API-R0-DASH B-count read model (API-OQ-03 resolved); fixture AGGREGATES has no production counterpart (DM-X-03)' },
  { name: 'useLiveAggregates', apiInv: 'REPLACE', note: 'live counters via the API-R0-DASH B-count read model (API-OQ-03 resolved); fixture AGGREGATES has no production counterpart (DM-X-03)' },
  { name: 'fetchDependencyClients', apiInv: 'REPLACE', note: 'server-derived waiting-on-client read model (API-R0-DLN); not a stored fixture' },
  { name: 'searchAll', apiInv: 'REPLACE', note: 'structured global search (API-R0-SRC — exactly six domains) via one SECURITY INVOKER function under caller RLS; page shortcuts stay client-side' },
  { name: 'WORKFLOW_STATES', apiInv: 'REPLACE', note: 'production workflow vocabulary derives from the approved domain state machines (DM-SM-01…06); the fixture constant must not become the authoritative production definition' },
  // DEMO-ONLY — fixture/demo mode only, no production counterpart in R0.
  { name: 'getTask', apiInv: 'DEMO-ONLY', note: 'sync fixture-era helper; production callers use the evolved fetchTask contract — must not become a production backend API merely because it exists' },
  { name: 'askCaos', apiInv: 'DEMO-ONLY', note: 'no R0 production counterpart; real AI deferred (DEC-C)' },
  { name: 'withLatency', apiInv: 'DEMO-ONLY', note: 'fixture-adapter internal; absent from the Supabase adapter' },
  { name: 'matchAskQuery', apiInv: 'DEMO-ONLY', note: 'Ask CAOS fixture internal' },
  { name: 'SUGGESTED_QUESTIONS', apiInv: 'DEMO-ONLY', note: 'Ask CAOS fixture internal' },
  { name: 'FALLBACK_ANSWER', apiInv: 'DEMO-ONLY', note: 'Ask CAOS fixture internal' },
  { name: 'getCompliance', apiInv: 'DEMO-ONLY', note: HELPER_NOTE },
  { name: 'dueDateFor', apiInv: 'DEMO-ONLY', note: HELPER_NOTE },
  { name: 'complianceName', apiInv: 'DEMO-ONLY', note: HELPER_NOTE },
  { name: 'daysUntil', apiInv: 'DEMO-ONLY', note: HELPER_NOTE },
  { name: 'ownerOf', apiInv: 'DEMO-ONLY', note: 'fixture lookup helper — fixture adapter internal' },
  { name: 'getClient', apiInv: 'DEMO-ONLY', note: 'fixture lookup helper — fixture adapter internal' },
  // Demo-mode overlay store itself.
  { name: 'DemoStoreProvider', apiInv: 'DEMO-ONLY', note: DEMO_STORE_NOTE },
  { name: 'useDemoStore', apiInv: 'DEMO-ONLY', note: DEMO_STORE_NOTE },
];

/**
 * Fixture-era data constants — DEMO-ONLY as data sources
 * (API-INV-01), each carrying its spec-10 mapping-table class.
 */
const FIXTURE_CONSTANT_REGISTRY = [
  { name: 'FIRM', mapping: 'DIRECT_SYNTHETIC', note: 'firms row; string id → uuid; team splits into profiles + memberships' },
  { name: 'TEAM', mapping: 'TRANSFORM', note: 'profiles + firm_memberships; one auth user + profile + membership per person; roles mapped to the SCH-03 role vocabulary' },
  { name: 'CLIENTS', mapping: 'TRANSFORM', note: 'clients + one default legal_entities row each; ownerId → owner_partner_membership_id (SCH-RESP-01); CLIENTS[].gstin/pan/cin → registrations rows (TRANSFORM, separate spec-10 row)' },
  { name: 'COMPLIANCE_MASTER', mapping: 'REFERENCE_SEED', note: 'compliance_types system defaults + initial compliance_rule_versions; seeded but not production-activated until external CA/domain sign-off — seeded statutory versions carry domain_approval_status=pending (SCH-32)' },
  { name: 'TASKS', mapping: 'TRANSFORM', note: "compliance_instances + tasks; generation_source 'import'/'manual', never claimed recurrence-generated (SCH-12); nextAction → tasks.next_action" },
  { name: 'REVIEW_ITEMS', mapping: 'TRANSFORM', note: 'review_items; display type strings → frozen R0 category keys (API-OQ-01; SCH-17 CHECK); comments → immutable task_comments (SCH-16)' },
  { name: 'ALERTS', mapping: 'TRANSFORM', note: 'alerts + alert_rules templates; alert-rule template seeding SUPERSEDED by the D3 ruling — R0 ships ZERO alert-rule seeds and zero default thresholds; AUTO-OQ-04 OPEN' },
  { name: 'DEPENDENCY_CLIENTS', mapping: 'DEMO_ONLY', note: 'none (derived) — production dependency board is derived from instances/tasks (AUTO-DLN-01); fixture stays in the demo adapter' },
  { name: 'ASK_FIXTURES', mapping: 'DEMO_ONLY', note: 'none — Ask CAOS is demo-only in R0; real AI deferred (DEC-C)' },
  { name: 'AGGREGATES', mapping: 'FIXTURE_ONLY_PRESENTATION', note: 'replaced by server-derived aggregates (DM-X-03, API-R0-DASH)' },
  { name: 'REVIEW_COUNTS', mapping: 'FIXTURE_ONLY_PRESENTATION', note: 'replaced by server-derived aggregates (DM-X-03, API-R0-DASH)' },
  { name: 'ACTIVE_ALERT_COUNT', mapping: 'FIXTURE_ONLY_PRESENTATION', note: 'replaced by server-derived aggregates (DM-X-03, API-R0-DASH)' },
  { name: 'DEPENDENCY_TOTALS', mapping: 'FIXTURE_ONLY_PRESENTATION', note: 'replaced by server-derived aggregates (DM-X-03, API-R0-DASH)' },
  { name: 'TOTAL_ACTIVE', mapping: 'FIXTURE_ONLY_PRESENTATION', note: 'replaced by server-derived aggregates (DM-X-03, API-R0-DASH)' },
  { name: 'DEMO_TODAY', mapping: 'DEMO_ONLY', note: 'none — pinned demo date (MIG-DS-04, TEN-22); production uses server time (API-CONV-04)' },
];

/** Fixture-era type exports (API-INV-01 DEMO-ONLY; mapping NOT_DATA — pure types). */
const FIXTURE_TYPE_NAMES = [
  'Industry',
  'EntityType',
  'ClientTag',
  'ComplianceId',
  'WorkflowState',
  'TaskCategory',
  'ReviewType',
  'ReviewStatus',
  'AlertSeverity',
  'TeamMember',
  'Firm',
  'Client',
  'ComplianceType',
  'RiskFactor',
  'Reminder',
  'WorkflowEvent',
  'TaskInstance',
  'DeadlineGroup',
  'ReviewItem',
  'FirmAlert',
  'DependencyClient',
  'AskChip',
  'AskTable',
  'AskAnswer',
  'FirmAggregates',
  'SearchHit',
  'DeadlineClientRow',
  'Toast',
];

/**
 * DemoStoreProvider overlay actions (API-INV-01 store-action rows). These
 * are NOT named barrel exports — they are returned by useDemoStore() — so
 * they are recorded here and rendered in the report, never merged into the
 * barrel-export registry.
 */
const STORE_ACTION_REGISTRY = [
  { name: 'approveReviewItem', apiInv: 'EVOLVE', note: "decide_review_item RPC with p_decision='approved' (API-R0-RVW); self-decision prohibited (RLS-4EY-04); audited" },
  { name: 'returnReviewItem', apiInv: 'EVOLVE', note: "decide_review_item RPC with p_decision='returned' + mandatory rationale; atomic linked-task returned + one immutable SCH-16 comment (DM-SM-06)" },
  { name: 'acknowledgeAlert', apiInv: 'EVOLVE', note: 'alert status RPC (RLS-ALR-01; manager+); audited' },
  { name: 'resolveAlert', apiInv: 'EVOLVE', note: "alert resolve RPC with resolution_type='manual' (DM-OQ-05); audited" },
  { name: 'sendReminder', apiInv: 'DEMO-ONLY', note: 'DEMO-ONLY in R0' },
  { name: 'notify', apiInv: 'KEEP', note: 'pure UI toast concern; unchanged' },
  { name: 'dismissToast', apiInv: 'KEEP', note: 'pure UI toast concern; unchanged' },
  { name: 'resetDemo', apiInv: 'DEMO-ONLY', note: 'demo-mode control only; never present in Supabase mode' },
];

const STORE_OVERLAY_NOTE =
  'store overlays (reviewOverlay, alertOverlay, reminder merge) are REPLACE as a concept — server state replaces overlays; the fixture adapter keeps them for demo mode. They are not named barrel exports.';

/**
 * API-INV-01 spec class lists (docs/spec/07-api-contract.md) — the
 * conformance oracle. Names that are barrel exports are checked against
 * the barrel registry; store-action names against STORE_ACTION_REGISTRY.
 */
const SPEC_API_INV = {
  EVOLVE: [
    'fetchClients', 'getClients', 'fetchClient', 'fetchTasks', 'getTasks', 'getTasksForClient',
    'fetchTask', 'fetchDeadlines', 'getDeadlineGroups', 'fetchDeadline', 'getDeadlineGroup',
    'fetchDeadlineClients', 'getDeadlineClients', 'fetchComplianceTasks', 'getTasksForCompliance',
    'fetchReviewItems', 'fetchAlerts', 'getFirm', 'getTeam', 'getComplianceMaster',
    'approveReviewItem', 'returnReviewItem', 'acknowledgeAlert', 'resolveAlert',
  ],
  REPLACE: ['getAggregates', 'fetchAggregates', 'useLiveAggregates', 'fetchDependencyClients', 'searchAll', 'WORKFLOW_STATES'],
  'DEMO-ONLY': [
    'getTask', 'askCaos', 'withLatency', 'matchAskQuery', 'SUGGESTED_QUESTIONS', 'FALLBACK_ANSWER',
    'getCompliance', 'dueDateFor', 'complianceName', 'daysUntil', 'ownerOf', 'getClient',
    'sendReminder', 'resetDemo',
    'FIRM', 'TEAM', 'CLIENTS', 'COMPLIANCE_MASTER', 'TASKS', 'AGGREGATES', 'REVIEW_ITEMS',
    'ALERTS', 'DEPENDENCY_CLIENTS', 'ASK_FIXTURES', 'ACTIVE_ALERT_COUNT', 'REVIEW_COUNTS',
    'DEPENDENCY_TOTALS', 'TOTAL_ACTIVE', 'DEMO_TODAY',
    'DemoStoreProvider', 'useDemoStore',
  ],
  KEEP: ['notify', 'dismissToast'],
};

/** Spec-10 fixture → production mapping table (docs/spec/10-migration-seed.md). */
const MAPPING_TABLE = [
  { sources: ['FIRM'], target: 'firms row', mapping: 'DIRECT_SYNTHETIC', note: 'String id → uuid; team splits into profiles + memberships' },
  { sources: ['TEAM'], target: 'profiles + firm_memberships', mapping: 'TRANSFORM', note: 'One auth user + profile + membership per person; roles mapped to the SCH-03 role vocabulary; fixture "owner" ids become membership ids' },
  { sources: ['CLIENTS'], target: 'clients + one default legal_entities row each', mapping: 'TRANSFORM', note: 'ownerId → owner_partner_membership_id (SCH-RESP-01); entityType → legal_entities.entity_type; tags, risk_rating map directly; offboarded semantics per DM-04' },
  { sources: [], pseudoSource: 'CLIENTS[].gstin/pan/cin', target: 'registrations rows', mapping: 'TRANSFORM', note: 'Identifier fields become typed registration rows (type ∈ GSTIN/PAN/CIN, SCH-07); multi-state GSTINs would need multiple rows — fixture holds at most one' },
  { sources: ['COMPLIANCE_MASTER'], target: 'compliance_types system defaults (NULL firm_id) + initial compliance_rule_versions', mapping: 'REFERENCE_SEED', note: "dueRule text → structured due_rule jsonb on the initial version (SCH-32); scope_kind/registration_class per the DM-27 matrix; seeded but not production-activated until external CA/domain sign-off — seeded statutory versions carry domain_approval_status='pending' (DM-OQ-01; SCH-32)" },
  { sources: ['TASKS'], target: 'compliance_instances + tasks', mapping: 'TRANSFORM', note: "Generator logic is discarded; fixture rows map to instances (structured periods; generation_source='import' or 'manual' — never claimed as recurrence-generated, SCH-12) and their linked tasks; nextAction → tasks.next_action; fixture string periods → period_start/period_end/period_label (SCH-12)" },
  { sources: ['REVIEW_ITEMS'], target: 'review_items', mapping: 'TRANSFORM', note: 'Display type strings → the frozen R0 category keys (API-OQ-01: gst_reconciliation, tds_return, itr_computation, financial_statements, audit_workpaper; SCH-17 CHECK); submitter names → memberships; comments → immutable task_comments (SCH-16); decision facts live on review_items, mutation history in audit_log' },
  { sources: ['ALERTS'], target: 'alerts + alert_rules templates', mapping: 'TRANSFORM', note: 'Each alert implies a rule; statuses map to the DM-22 lifecycle. Alert-rule template seeding is SUPERSEDED by the D3 ruling (recorded in SCH-19; reaffirmed by human ruling HRR-07=A): R0 ships ZERO alert-rule seed rows and zero default thresholds — schema capability (SCH-19) is not approved seed content; AUTO-OQ-04 remains OPEN' },
  { sources: ['DEPENDENCY_CLIENTS'], target: 'none (derived)', mapping: 'DEMO_ONLY', note: 'Production dependency board is derived from instances/tasks (AUTO-DLN-01); fixture stays in the demo adapter' },
  { sources: ['ASK_FIXTURES'], target: 'none', mapping: 'DEMO_ONLY', note: 'Ask CAOS is demo-only in R0; real AI deferred (DEC-C)' },
  { sources: ['AGGREGATES', 'REVIEW_COUNTS', 'ACTIVE_ALERT_COUNT', 'DEPENDENCY_TOTALS', 'TOTAL_ACTIVE'], target: 'none', mapping: 'FIXTURE_ONLY_PRESENTATION', note: 'Replaced by server-derived aggregates (DM-X-03, API-R0-DASH)' },
  { sources: ['DEMO_TODAY'], target: 'none (pinned demo date)', mapping: 'DEMO_ONLY', note: 'Pinned per MIG-DS-04; production uses server time (API-CONV-04)' },
];

const FIXTURE_ONLY_PRESENTATION_NAMES = ['AGGREGATES', 'REVIEW_COUNTS', 'ACTIVE_ALERT_COUNT', 'DEPENDENCY_TOTALS', 'TOTAL_ACTIVE'];
const DEMO_ONLY_SOURCE_NAMES = ['DEPENDENCY_CLIENTS', 'ASK_FIXTURES', 'DEMO_TODAY'];

/** Non-vacuity guards: these names MUST appear in the enumeration. */
const SANITY_FIXTURE_VALUES = [
  'FIRM', 'TEAM', 'CLIENTS', 'COMPLIANCE_MASTER', 'TASKS', 'REVIEW_ITEMS', 'ALERTS',
  'DEPENDENCY_CLIENTS', 'ASK_FIXTURES', 'AGGREGATES', 'REVIEW_COUNTS', 'ACTIVE_ALERT_COUNT',
  'DEPENDENCY_TOTALS', 'TOTAL_ACTIVE', 'DEMO_TODAY', 'WORKFLOW_STATES',
  'fetchClients', 'fetchTask', 'searchAll', 'askCaos', 'withLatency',
  'DemoStoreProvider', 'useDemoStore', 'useLiveAggregates',
];
const SANITY_PRODUCTION_CONTRACT = [
  'getDataSource', 'validateStartupConfig', 'ApiError', 'ConfigurationError', 'toApiError',
  'setActiveFirm', 'getActiveFirm', 'clearActiveFirm', 'resolveDefaultActiveFirm',
  'clientHierarchyService', 'engagementService', 'complianceRulesService', 'complianceInstancesService',
  'taskService', 'reviewService', 'client360Service', 'alertsService', 'deadlinesService',
  'dashboardService', 'searchService', 'myworkService', 'tenancyService', 'authService',
  'AuthProvider', 'useAuth',
];

/** TEST-MIG-01…15 disposition matrix (docs/spec/11-testing-harness.md). */
const TEST_MIG_MATRIX = [
  { id: 'TEST-MIG-01', title: 'Phase A clean-chain reproducibility', category: 'B', evidence: 'Harness Gate db-reset-seed phase re-applies the migration chain every run; IMP-010 byte-identical schema acceptance evidence cited', owner: 'IMP-003/IMP-010 evidence, IMP-070 records' },
  { id: 'TEST-MIG-02', title: 'Adapter contract parity (MIG-VAL-03)', category: 'A', evidence: 'new tests/integration/migration/adapter-parity.test.ts — same @/data contract calls against fixture AND supabase adapters for all 12 domain services, DTO shape equality', owner: 'IMP-070, wired into gate' },
  { id: 'TEST-MIG-03', title: 'Phase C seed invariant checks (MIG-VAL-01)', category: 'B', evidence: 'compliance/seed integration suites green at head; named invariant suite (TEST-MIG-12) covers row-level checks', owner: 'IMP-031-family evidence, IMP-070 records' },
  { id: 'TEST-MIG-04', title: 'Read-model vs base-table consistency spot checks', category: 'A', evidence: 'new tests/integration/migration/read-model-consistency.test.ts — dashboard/deadline/search read models vs base-table derivations on seeded data', owner: 'IMP-070, wired into gate' },
  { id: 'TEST-MIG-05', title: 'Phase E production smoke suite', category: 'E', evidence: 'production not provisioned (DEC-P gated); zero IMP-070 execution claimed', owner: 'IMP-071/IMP-072 (Phase E)' },
  { id: 'TEST-MIG-06', title: 'Fixture mode intact while Supabase mode exists (MIG-PRIN-02)', category: 'B', evidence: 'tests/unit/fixture-no-network.test.ts + e2e/smoke.spec.ts fixture project green at head', owner: 'IMP-014 evidence, IMP-070 re-verifies' },
  { id: 'TEST-MIG-07', title: 'Supabase mode with no fixture modules loaded (MIG-DS-06a)', category: 'B (import-level) + E (bundle-level leg)', evidence: 'tests/unit/import-boundary.test.ts green incl. LOW-3 non-vacuity guards; bundle-level fixture exclusion remains Phase-E/MIG-VFY-E owned', owner: 'IMP-014 evidence + Phase E' },
  { id: 'TEST-MIG-08', title: 'Fail-closed startup matrix; no runtime fallback (MIG-DS-03/05/06c)', category: 'B', evidence: 'tests/unit/data-source.test.ts green at head; no new fallback path introduced by IMP-070 tooling', owner: 'IMP-014 evidence, IMP-070 re-verifies' },
  { id: 'TEST-MIG-09', title: 'Fixture records cannot enter a supabase DB via seeds (MIG-SEED-06)', category: 'A', evidence: 'new tests/integration/migration/seed-labelling.test.ts — executable refusal proof for non-local invocation; seed.sql environment label verified; no seed tooling references fixture modules', owner: 'IMP-070, wired into gate' },
  { id: 'TEST-MIG-10', title: 'Deterministic dev seeds, stable ids (MIG-OQ-02)', category: 'B', evidence: 'tests/harness/registry.json fixed-UUID registry + seed-harness idempotency + gate db-reset-seed phase green at head; MIG-OQ-02 de-facto resolved at IMP-003', owner: 'IMP-003 evidence, IMP-070 re-verifies' },
  { id: 'TEST-MIG-11', title: 'Migration ordering clean from scratch + incremental (local→staging rehearsal)', category: 'B (local leg) + D (staging rehearsal leg)', evidence: 'local from-scratch leg proven every gate run; staging rehearsal is IMP-071-owned', owner: 'IMP-071 owns staging leg' },
  { id: 'TEST-MIG-12', title: 'Data-integrity suites at every phase gate (MIG-VAL-01)', category: 'A (local)', evidence: 'new tests/integration/migration/mig-val-01-invariants.test.ts — catalog invariants (24 tables, RLS 24/24, FORCE 20, policies 51), seed row counts, orphan scan, uniqueness, CHECK vocabulary conformance, generation provenance, audit presence', owner: 'IMP-070 local; staging re-run IMP-071' },
  { id: 'TEST-MIG-13', title: 'Pilot-data backfill path if invoked (MIG-PD-01)', category: 'C', evidence: 'trigger condition (pilot/customer data introduced before cutover) has NOT occurred; no synthetic PASS; MIG-PD-01 text untouched', owner: 'if ever triggered: mandatory documented path before Phase E (IMP-071/072)' },
  { id: 'TEST-MIG-14', title: 'Rollback/recovery rehearsals per phase', category: 'D', evidence: 'rollback conditions documented in spec 10; staging rehearsal/disposable-rebuild drill is IMP-071 scope', owner: 'IMP-071' },
  { id: 'TEST-MIG-15', title: 'Seeded statutory rule versions pending, cannot activate (MIG-SEED-02, SCH-32)', category: 'A (local)', evidence: 'new tests/integration/migration/statutory-pending.test.ts — every seeded statutory version draft+pending, zero active statutory, activation path rejects without domain sign-off', owner: 'IMP-070 local; staging re-run IMP-071' },
];

const TEST_MIG_COMPLETENESS_NOTE =
  'Matrix completeness: 15/15 present; category totals A=5 (02, 04, 09, 12, 15), B=6 (01, 03, 06, 07, 08, 10), C=1 (13), D=2 (11, 14), E=1 (05); overlaps: 07 carries an E leg (bundle-level), 11 carries a B local leg, 12/15 staging re-runs are IMP-071 legs. No synthetic PASS terminology for conditional/deferred entries.';

// ---------------------------------------------------------------------------
// Registry construction.
// ---------------------------------------------------------------------------

function buildExplicitFixtureRegistry() {
  const registry = new Map();
  for (const e of FIXTURE_VALUE_REGISTRY) {
    registry.set(e.name, { apiInv: e.apiInv, mapping: 'NOT_DATA', note: e.note });
  }
  for (const e of FIXTURE_CONSTANT_REGISTRY) {
    registry.set(e.name, { apiInv: 'DEMO-ONLY', mapping: e.mapping, note: e.note });
  }
  for (const name of FIXTURE_TYPE_NAMES) {
    registry.set(name, { apiInv: 'DEMO-ONLY', mapping: 'NOT_DATA', note: FIXTURE_TYPE_NOTE });
  }
  return registry;
}

/**
 * Classify the full enumeration. Returns { registry, unclassified } where
 * registry maps name → { apiInv, mapping, note, surface }.
 */
function classify(enumeration, explicit) {
  const registry = new Map();
  const unclassified = [];
  for (const row of enumeration) {
    const hit = explicit.get(row.name);
    if (hit) {
      registry.set(row.name, { ...hit, surface: 'fixture-era' });
      continue;
    }
    if (FIXTURE_MODULE_PATHS.has(row.source)) {
      unclassified.push(row.name);
      continue;
    }
    registry.set(row.name, { apiInv: 'KEEP', mapping: 'NOT_DATA', note: PRODUCTION_NOTE, surface: 'production dual-mode contract' });
  }
  return { registry, unclassified };
}

// ---------------------------------------------------------------------------
// Step 3 — validations (fail closed).
// ---------------------------------------------------------------------------

function runChecks(enumeration, registry, unclassified, explicit) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });
  const names = new Set(enumeration.map((e) => e.name));

  const missingFixtureSanity = SANITY_FIXTURE_VALUES.filter((n) => !names.has(n));
  push(
    'sanity-nonvacuity-fixture-values',
    missingFixtureSanity.length === 0,
    missingFixtureSanity.length === 0
      ? `all ${SANITY_FIXTURE_VALUES.length} fixture-era sanity exports present in the enumeration`
      : `missing from enumeration: ${missingFixtureSanity.join(', ')}`,
  );

  const missingProductionSanity = SANITY_PRODUCTION_CONTRACT.filter((n) => !names.has(n));
  push(
    'sanity-nonvacuity-production-contract',
    missingProductionSanity.length === 0,
    missingProductionSanity.length === 0
      ? `all ${SANITY_PRODUCTION_CONTRACT.length} production-contract sanity exports present in the enumeration`
      : `missing from enumeration: ${missingProductionSanity.join(', ')}`,
  );

  const notClassified = enumeration.map((e) => e.name).filter((n) => !registry.has(n));
  const offenders = [...new Set([...unclassified, ...notClassified])].sort();
  push(
    'registry-coverage',
    offenders.length === 0,
    offenders.length === 0
      ? `every one of the ${enumeration.length} enumerated barrel exports is classified (zero unclassified)`
      : `unclassified exports: ${offenders.join(', ')}`,
  );

  const stale = [...explicit.keys()].filter((n) => !names.has(n)).sort();
  push(
    'registry-staleness',
    stale.length === 0,
    stale.length === 0
      ? 'every explicit fixture-era registry entry exists in the enumeration (zero stale entries)'
      : `stale registry entries: ${stale.join(', ')}`,
  );

  const apiInvMismatch = [];
  const storeActions = new Map(STORE_ACTION_REGISTRY.map((a) => [a.name, a.apiInv]));
  for (const [specClass, list] of Object.entries(SPEC_API_INV)) {
    for (const name of list) {
      if (storeActions.has(name)) {
        if (storeActions.get(name) !== specClass) {
          apiInvMismatch.push(`${name}: store-action registry ${storeActions.get(name)} != spec ${specClass}`);
        }
      } else if (registry.has(name)) {
        if (registry.get(name).apiInv !== specClass) {
          apiInvMismatch.push(`${name}: registry ${registry.get(name).apiInv} != spec ${specClass}`);
        }
      } else {
        apiInvMismatch.push(`${name}: named in API-INV-01 spec lists but absent from enumeration and store-action registry`);
      }
    }
  }
  push(
    'api-inv-01-conformance',
    apiInvMismatch.length === 0,
    apiInvMismatch.length === 0
      ? 'registry API-INV-01 classes match docs/spec/07-api-contract.md for every spec-named fixture-era export and store action'
      : `mismatches: ${apiInvMismatch.join('; ')}`,
  );

  const mappingMismatch = [];
  for (const row of MAPPING_TABLE) {
    for (const src of row.sources) {
      if (!names.has(src)) {
        mappingMismatch.push(`${src}: mapping-table source absent from enumeration`);
      } else if (registry.get(src).mapping !== row.mapping) {
        mappingMismatch.push(`${src}: registry mapping ${registry.get(src).mapping} != spec-10 ${row.mapping}`);
      }
    }
  }
  push(
    'spec-10-mapping-conformance',
    mappingMismatch.length === 0,
    mappingMismatch.length === 0
      ? 'every spec-10 mapping-table fixture source exists in the enumeration with the exact spec mapping class'
      : `mismatches: ${mappingMismatch.join('; ')}`,
  );

  const unsupported = [...registry.entries()].filter(([, v]) => v.apiInv === 'unsupported').map(([k]) => k);
  push(
    'no-unsupported-classifications',
    unsupported.length === 0,
    unsupported.length === 0
      ? "zero exports classified 'unsupported' (MIG-ACC-03)"
      : `unsupported exports (gate-failing class): ${unsupported.join(', ')}`,
  );

  const fopBad = FIXTURE_ONLY_PRESENTATION_NAMES.filter((n) => !registry.has(n) || registry.get(n).mapping !== 'FIXTURE_ONLY_PRESENTATION');
  push(
    'fixture-only-presentation-identified',
    fopBad.length === 0,
    fopBad.length === 0
      ? `fixture-only presentation data explicitly identified: ${FIXTURE_ONLY_PRESENTATION_NAMES.join(', ')}`
      : `not classified FIXTURE_ONLY_PRESENTATION: ${fopBad.join(', ')}`,
  );

  const demoBad = DEMO_ONLY_SOURCE_NAMES.filter((n) => !registry.has(n) || registry.get(n).mapping !== 'DEMO_ONLY');
  push(
    'demo-only-sources-identified',
    demoBad.length === 0,
    demoBad.length === 0
      ? `demo-only sources explicitly identified: ${DEMO_ONLY_SOURCE_NAMES.join(', ')}`
      : `not classified DEMO_ONLY: ${demoBad.join(', ')}`,
  );

  const apiInvCounts = {};
  for (const c of API_INV_CLASSES) apiInvCounts[c] = 0;
  const mappingCounts = {};
  for (const c of MAPPING_CLASSES) mappingCounts[c] = 0;
  for (const v of registry.values()) {
    apiInvCounts[v.apiInv] += 1;
    mappingCounts[v.mapping] += 1;
  }
  const apiInvTotal = Object.values(apiInvCounts).reduce((a, b) => a + b, 0);
  const mappingTotal = Object.values(mappingCounts).reduce((a, b) => a + b, 0);
  const countsOk = registry.size === enumeration.length && apiInvTotal === enumeration.length && mappingTotal === enumeration.length;
  push(
    'count-totals',
    countsOk,
    countsOk
      ? `class counts sum to the enumeration size (${enumeration.length})`
      : `count mismatch: registry ${registry.size}, apiInv total ${apiInvTotal}, mapping total ${mappingTotal}, enumeration ${enumeration.length}`,
  );

  return { checks, apiInvCounts, mappingCounts };
}

// ---------------------------------------------------------------------------
// Report generation (deterministic, byte-stable).
// ---------------------------------------------------------------------------

function md(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(headers, rows) {
  const lines = [];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) lines.push(`| ${row.map(md).join(' | ')} |`);
  return lines.join('\n');
}

function renderReport(enumeration, registry, apiInvCounts, mappingCounts) {
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const rows = enumeration.map((e) => ({ ...e, cls: registry.get(e.name) }));
  const fixtureRows = rows.filter((r) => r.cls.surface === 'fixture-era').sort(byName);
  const productionRows = rows.filter((r) => r.cls.surface === 'production dual-mode contract').sort(byName);
  const classRow = (r) => [`\`${r.name}\``, r.kind, r.cls.apiInv, r.cls.mapping, r.cls.note];

  const lines = [];
  lines.push('# Fixture → Production Mapping Validation Report');
  lines.push('');
  lines.push('> GENERATED FILE — do not hand-edit. Regenerate from the `app/` directory with:');
  lines.push('>');
  lines.push(`> \`${GENERATOR_CMD}\``);
  lines.push('>');
  lines.push('> Drift between this file and the generator is caught by the Harness Gate via');
  lines.push('> `node scripts/validation/mapping-validation.mjs --check-report`.');
  lines.push('');
  lines.push('- **Package:** IMP-070 — Fixture demo preservation & adapter completion.');
  lines.push('- **Governing IDs:** IMP-070, TEST-MIG-01…15, MIG-ACC-03, MIG-VAL-03, API-INV-01, spec-10 mapping table.');
  lines.push('- **Sources:** `docs/spec/07-api-contract.md` (API-INV-01 export classification); `docs/spec/10-migration-seed.md` (fixture → production mapping table, MIG-SEED/MIG-VAL/MIG-ACC); `docs/spec/11-testing-harness.md` (TEST-MIG-01…15).');
  lines.push('- **Status:** non-normative document. The normative sources are the spec documents above; this report is the rendered, continuously re-validated encoding of them.');
  lines.push('');
  lines.push('## 1. Classification summary');
  lines.push('');
  lines.push(`Total barrel-reachable exports enumerated from \`src/data/index.ts\`: **${enumeration.length}**.`);
  lines.push('');
  lines.push('API-INV-01 classes:');
  lines.push('');
  lines.push(table(['API-INV-01 class', 'Count'], API_INV_CLASSES.map((c) => [c, String(apiInvCounts[c])])));
  lines.push('');
  lines.push('Spec-10 mapping classes:');
  lines.push('');
  lines.push(table(['Spec-10 mapping class', 'Count'], MAPPING_CLASSES.map((c) => [c, String(mappingCounts[c])])));
  lines.push('');
  lines.push('## 2. Full barrel-export classification');
  lines.push('');
  lines.push('Every export reachable from the barrel, classified. The production dual-mode contract surface (services, boundary helpers, domain DTO types, error/context/source exports, tenancy/auth) is `KEEP` / `NOT_DATA` and is not part of the fixture-era API-INV-01 surface.');
  lines.push('');
  lines.push(`### 2a. Fixture-era surface (${fixtureRows.length} exports)`);
  lines.push('');
  lines.push(table(['Export', 'Kind', 'API-INV-01 class', 'Spec-10 mapping class', 'Note'], fixtureRows.map(classRow)));
  lines.push('');
  lines.push(`### 2b. Production dual-mode contract surface (${productionRows.length} exports)`);
  lines.push('');
  lines.push(table(['Export', 'Kind', 'API-INV-01 class', 'Spec-10 mapping class', 'Note'], productionRows.map(classRow)));
  lines.push('');
  lines.push('## 3. Demo-store overlay actions (not barrel exports)');
  lines.push('');
  lines.push('The `DemoStoreProvider` overlay actions are returned by `useDemoStore()` and are therefore not named barrel exports; their API-INV-01 classes are recorded here for completeness:');
  lines.push('');
  lines.push(table(['Store action', 'API-INV-01 class', 'Note'], STORE_ACTION_REGISTRY.map((a) => [`\`${a.name}\``, a.apiInv, a.note])));
  lines.push('');
  lines.push(STORE_OVERLAY_NOTE);
  lines.push('');
  lines.push('## 4. Fixture → production mapping table (spec 10)');
  lines.push('');
  lines.push('The mapping table below is the executable encoding of the fixture → production entity mapping in `docs/spec/10-migration-seed.md`; the validator asserts each fixture source exists in the barrel enumeration with the exact mapping class shown.');
  lines.push('');
  lines.push(
    table(
      ['Fixture source', 'Production target', 'Mapping class', 'Notes'],
      MAPPING_TABLE.map((r) => [
        r.sources.length > 0 ? r.sources.map((s) => `\`${s}\``).join(', ') : `\`${r.pseudoSource}\``,
        r.target,
        r.mapping,
        r.note,
      ]),
    ),
  );
  lines.push('');
  lines.push('## 5. Fixture-only presentation data');
  lines.push('');
  lines.push('These five constants are pre-computed fixture counters with no production counterpart. They are replaced by server-derived aggregates (DM-X-03, API-R0-DASH) and must never become a production data source:');
  lines.push('');
  lines.push(
    table(
      ['Constant', 'Fixture role'],
      FIXTURE_ONLY_PRESENTATION_NAMES.map((n) => [`\`${n}\``, registry.get(n).note]),
    ),
  );
  lines.push('');
  lines.push('## 6. Demo-only sources');
  lines.push('');
  lines.push('- `DEPENDENCY_CLIENTS` — the production client-dependency board is derived from instances/tasks (AUTO-DLN-01); the fixture stays in the demo adapter.');
  lines.push('- `ASK_FIXTURES` — Ask CAOS is demo-only in R0; the canned assistant (`askCaos`, `matchAskQuery`, `SUGGESTED_QUESTIONS`, `FALLBACK_ANSWER`) has no R0 production counterpart (real AI deferred, DEC-C).');
  lines.push('- `DEMO_TODAY` — the pinned demo date (MIG-DS-04, TEN-22); production uses server time (API-CONV-04).');
  lines.push('- The demo store (`DemoStoreProvider` / `useDemoStore`) is demo-mode only; its overlay actions are classified in section 3.');
  lines.push('');
  lines.push('## 7. TEST-MIG-01…15 disposition matrix');
  lines.push('');
  lines.push('Categories: A = executed in IMP-070 (new local evidence); B = existing evidence reused/re-verified; C = conditional, not invoked; D = deferred to IMP-071; E = Phase-E/later verification.');
  lines.push('');
  lines.push(
    table(
      ['ID', 'Title', 'Category', 'Disposition / evidence', 'Owner'],
      TEST_MIG_MATRIX.map((t) => [t.id, t.title, t.category, t.evidence, t.owner]),
    ),
  );
  lines.push('');
  lines.push(TEST_MIG_COMPLETENESS_NOTE);
  lines.push('');
  lines.push('## 8. Limitations');
  lines.push('');
  lines.push('1. **Granularity.** Classification is at barrel-export granularity; field-level transformation rules live in `docs/spec/10-migration-seed.md` and are not re-stated here.');
  lines.push('2. **Bundle-level fixture exclusion.** Verifying that no fixture module ships in a production bundle is Phase-E/MIG-VFY-E scope; TEST-MIG-07 is covered at import level only here.');
  lines.push('3. **Hosted demo checks.** Hosted demo read-only GET checks are evidence-gathering outside the gate.');
  lines.push("4. **Vocabulary.** The MIG-ACC-03 'unsupported' vocabulary differs from the spec-10 mapping-table vocabulary; this is noted deliberately — zero exports are classified 'unsupported' and the validator fails closed if any ever are.");
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const writeReport = args.includes('--write-report');
  const checkReport = args.includes('--check-report');
  const unknown = args.filter((a) => a !== '--write-report' && a !== '--check-report');
  if (unknown.length > 0) {
    console.error(`unknown arguments: ${unknown.join(', ')}`);
    process.exit(1);
  }
  const mode = writeReport ? 'write-report' : checkReport ? 'check-report' : 'validate';

  if (!existsSync(BARREL)) {
    console.error(`barrel not found at ${BARREL} — run this script with cwd = app/`);
    process.exit(1);
  }

  const enumeration = enumerateBarrel(BARREL);
  const explicit = buildExplicitFixtureRegistry();
  const { registry, unclassified } = classify(enumeration, explicit);
  const { checks, apiInvCounts, mappingCounts } = runChecks(enumeration, registry, unclassified, explicit);

  const report = renderReport(enumeration, registry, apiInvCounts, mappingCounts);

  if (mode === 'check-report') {
    let committed = null;
    try {
      committed = readFileSync(REPORT_PATH, 'utf8');
    } catch {
      committed = null;
    }
    const driftOk = committed === report;
    checks.push({
      name: 'report-drift',
      ok: driftOk,
      detail: driftOk
        ? `committed ${REPORT_PATH} is byte-identical to the generated report`
        : committed === null
          ? `committed report ${REPORT_PATH} is missing — regenerate with --write-report`
          : `committed report ${REPORT_PATH} differs from the generated report — regenerate with --write-report`,
    });
  }

  const failed = checks.filter((c) => !c.ok);

  if (mode === 'write-report') {
    if (failed.length === 0) {
      writeFileSync(REPORT_PATH, report, 'utf8');
      checks.push({
        name: 'report-write',
        ok: true,
        detail: `regenerated ${REPORT_PATH}`,
      });
    } else {
      checks.push({
        name: 'report-write',
        ok: false,
        detail: 'validation failed — report NOT regenerated',
      });
    }
  }

  const result = {
    tool: 'mapping-validation',
    package: 'IMP-070',
    mode,
    barrel: BARREL,
    report: REPORT_PATH,
    exportCount: enumeration.length,
    counts: {
      apiInv: apiInvCounts,
      mapping: mappingCounts,
    },
    checks,
    status: failed.length === 0 ? 'PASS' : 'FAIL',
  };
  console.log(JSON.stringify(result, null, 2));
  if (failed.length > 0) {
    console.error(`mapping-validation FAILED: ${failed.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
