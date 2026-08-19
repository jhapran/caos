// Deterministic task-instance generator.
// Produces exactly 1,284 active task instances whose category totals reconcile
// with the PRD aggregates: 912 completed · 215 in progress · 103 waiting ·
// 38 under review · 16 not started (the 16 not-started are exactly the at-risk set).

import { CLIENTS, ownerOf, TEAM } from './clients';
import { COMPLIANCE_MASTER, dueDateFor, getCompliance } from './compliance';
import type {
  Client,
  ClientTag,
  ComplianceId,
  RiskFactor,
  TaskCategory,
  TaskInstance,
  WorkflowEvent,
  WorkflowState,
} from './types';

export const DEMO_TODAY = new Date('2025-09-09T09:30:00+05:30');

// --- seeded PRNG (mulberry32) so the dataset is stable across reloads ---
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20250909);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

const TAG_TO_COMPLIANCE: Partial<Record<ClientTag, ComplianceId[]>> = {
  GST: ['gstr1', 'gstr3b'],
  TDS: ['tds24q', 'tds26q'],
  Audit: ['tax-audit', 'stat-audit'],
  MCA: ['mca-aoc4', 'mca-mgt7'],
  ITR: ['itr'],
  'Advance Tax': ['advance-tax'],
  'PF/ESI': ['pf-esi'],
};

const MISSING_DOC_POOL = [
  'Bank statements (Aug)', 'Purchase register', 'Sales register', 'GSTR-2A reconciliation',
  'TDS challans', 'Form 16A', 'Trial balance', 'Fixed asset register', 'Loan statements',
  'Rent agreements', 'Salary register', 'Input tax credit workings', '26AS statement',
  'Board resolution', 'Director KYC (DIR-3)', 'Inventory statement',
];

interface Combo { client: Client; complianceId: ComplianceId; periods: string[] }

function buildCombos(): Combo[] {
  const combos: Combo[] = [];
  for (const client of CLIENTS) {
    for (const tag of client.tags) {
      for (const cid of TAG_TO_COMPLIANCE[tag] ?? []) {
        const master = COMPLIANCE_MASTER.find((m) => m.id === cid)!;
        // most recent period first
        combos.push({ client, complianceId: cid, periods: [...master.periods].reverse() });
      }
    }
  }
  return combos;
}

interface RawTask {
  client: Client;
  complianceId: ComplianceId;
  period: string;
  dueDate: string;
}

/** Round-robin across combos (most-recent period first) until `count` tasks exist. */
function generateRaw(count: number): RawTask[] {
  const combos = buildCombos();
  const cursors = new Array(combos.length).fill(0);
  const out: RawTask[] = [];
  let progress = true;
  while (out.length < count && progress) {
    progress = false;
    for (let i = 0; i < combos.length && out.length < count; i++) {
      const combo = combos[i];
      const cursor = cursors[i];
      if (cursor < combo.periods.length) {
        const period = combo.periods[cursor];
        out.push({
          client: combo.client,
          complianceId: combo.complianceId,
          period,
          dueDate: dueDateFor(combo.complianceId, period),
        });
        cursors[i] = cursor + 1;
        progress = true;
      }
    }
  }
  return out;
}

const QUOTA: { category: TaskCategory; count: number }[] = [
  { category: 'in-progress', count: 215 },
  { category: 'waiting', count: 103 },
  { category: 'under-review', count: 38 },
  { category: 'not-started', count: 16 },
];
export const TOTAL_ACTIVE = 1284;

const STATE_BY_CATEGORY: Record<TaskCategory, WorkflowState[]> = {
  'completed': ['Filed', 'Acknowledgement Received', 'Closed'],
  'in-progress': ['Preparation', 'Information Received'],
  'waiting': ['Information Requested', 'Client Approval'],
  'under-review': ['Internal Review'],
  'not-started': ['Not Started'],
};

function riskFor(category: TaskCategory, daysLeft: number): { score: number; factors: RiskFactor[] } {
  const f: RiskFactor[] = [];
  let target: number;
  if (category === 'not-started') {
    target = 72 + Math.floor(rand() * 24);
    f.push({ label: 'Work not started', points: 40, detail: 'No preparation activity recorded' });
    f.push({ label: daysLeft < 0 ? `Overdue by ${-daysLeft} days` : `Due in ${daysLeft} days`, points: target - 52, detail: 'Statutory due date proximity' });
    f.push({ label: 'Documents missing', points: 12, detail: 'Client information pending' });
  } else if (category === 'waiting') {
    target = 44 + Math.floor(rand() * 20);
    f.push({ label: 'Awaiting client information', points: 28, detail: 'Reminder cycle active' });
    f.push({ label: daysLeft < 0 ? `Overdue by ${-daysLeft} days` : `Due in ${daysLeft} days`, points: Math.max(4, target - 36), detail: 'Statutory due date proximity' });
    f.push({ label: 'Owner workload', points: 8, detail: 'Team capacity check' });
  } else if (category === 'under-review') {
    target = 25 + Math.floor(rand() * 18);
    f.push({ label: 'In internal review', points: 18, detail: 'Reviewer assigned' });
    f.push({ label: 'Due date proximity', points: target - 22, detail: 'Within review SLA' });
    f.push({ label: 'Data completeness', points: 4, detail: 'All documents received' });
  } else if (category === 'in-progress') {
    target = 15 + Math.floor(rand() * 22);
    f.push({ label: 'Preparation underway', points: 10, detail: 'Work started on schedule' });
    f.push({ label: 'Due date proximity', points: Math.max(2, target - 16), detail: 'Timeline on track' });
    f.push({ label: 'Data completeness', points: 3, detail: 'Documents received' });
  } else {
    target = 2 + Math.floor(rand() * 12);
    f.push({ label: 'Filed on time', points: target, detail: 'No risk factors' });
  }
  const score = Math.max(0, Math.min(100, f.reduce((s, x) => s + x.points, 0)));
  return { score, factors: f };
}

function buildHistory(state: WorkflowState, dueDate: string, actor: string): WorkflowEvent[] {
  const order: WorkflowState[] = [
    'Not Started', 'Information Requested', 'Information Received', 'Preparation',
    'Internal Review', 'Client Approval', 'Ready to File', 'Filed',
    'Acknowledgement Received', 'Closed',
  ];
  const idx = order.indexOf(state);
  const due = new Date(dueDate).getTime();
  const events: WorkflowEvent[] = [];
  for (let i = 0; i <= idx; i++) {
    const at = new Date(due - (idx - i + 2) * 3 * 86400000 - Math.floor(rand() * 86400000));
    events.push({ state: order[i], at: at.toISOString(), actor });
  }
  return events;
}

function generateTasks(): TaskInstance[] {
  const raw = generateRaw(TOTAL_ACTIVE);
  const today = DEMO_TODAY.getTime();
  const daysLeft = (d: string) => Math.round((new Date(d).getTime() - today) / 86400000);

  // Pending pool: everything due today or later, plus the most recently-due
  // past tasks (overdue-but-actionable) to reach the pending quota of 372.
  const pendingQuota = QUOTA.reduce((s, q) => s + q.count, 0);
  const future = raw.filter((t) => daysLeft(t.dueDate) >= 0);
  const past = raw
    .filter((t) => daysLeft(t.dueDate) < 0)
    .sort((a, b) => (daysLeft(b.dueDate) - daysLeft(a.dueDate)));
  const pending = [...future, ...past.slice(0, Math.max(0, pendingQuota - future.length))];
  const completed = past.slice(Math.max(0, pendingQuota - future.length));

  // Shuffle pending deterministically, then cut into category quotas.
  const shuffled = [...pending];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const tasks: TaskInstance[] = [];
  let n = 0;
  const emit = (r: RawTask, category: TaskCategory) => {
    n += 1;
    const dl = daysLeft(r.dueDate);
    const state = pick(STATE_BY_CATEGORY[category]);
    const { score, factors } = riskFor(category, dl);
    const owner = rand() < 0.7 ? ownerOf(r.client.ownerId) : pick(TEAM);
    const isWaiting = category === 'waiting';
    const missingDocs = isWaiting || category === 'not-started'
      ? Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(MISSING_DOC_POOL))
          .filter((v, i, a) => a.indexOf(v) === i)
      : [];
    const reminders = isWaiting
      ? Array.from({ length: 1 + Math.floor(rand() * 2) }, (_, k) => ({
          sentAt: new Date(today - (k + 1) * 2 * 86400000).toISOString(),
          channel: pick(['Email', 'WhatsApp', 'Call'] as const),
          by: owner.name,
        }))
      : [];
    tasks.push({
      id: `t-${String(n).padStart(4, '0')}`,
      clientId: r.client.id,
      complianceId: r.complianceId,
      period: r.period,
      dueDate: r.dueDate,
      state,
      category,
      ownerId: owner.id,
      riskScore: score,
      riskFactors: factors,
      missingDocs,
      reminders,
      history: buildHistory(state, r.dueDate, owner.name),
      filedAt: category === 'completed'
        ? new Date(new Date(r.dueDate).getTime() - (1 + Math.floor(rand() * 5)) * 86400000).toISOString()
        : undefined,
      atRisk: category === 'not-started',
    });
  };

  for (const r of completed) emit(r, 'completed');
  let cursor = 0;
  for (const { category, count } of QUOTA) {
    // not-started: prefer the most urgent pending tasks (soonest due / most overdue)
    if (category === 'not-started') {
      const rest = shuffled.slice(cursor);
      rest.sort((a, b) => daysLeft(a.dueDate) - daysLeft(b.dueDate));
      for (let i = 0; i < count; i++) emit(rest[i], category);
      cursor += count;
    } else {
      for (let i = 0; i < count; i++) emit(shuffled[cursor + i], category);
      cursor += count;
    }
  }
  return tasks;
}

export const TASKS: TaskInstance[] = generateTasks();

export const AGGREGATES = {
  active: TASKS.length,
  completed: TASKS.filter((t) => t.category === 'completed').length,
  inProgress: TASKS.filter((t) => t.category === 'in-progress').length,
  waiting: TASKS.filter((t) => t.category === 'waiting').length,
  underReview: TASKS.filter((t) => t.category === 'under-review').length,
  notStarted: TASKS.filter((t) => t.category === 'not-started').length,
  atRisk: TASKS.filter((t) => t.atRisk).length,
};

export function getTask(id: string): TaskInstance | undefined {
  return TASKS.find((t) => t.id === id);
}

export function getTasksForClient(clientId: string): TaskInstance[] {
  return TASKS.filter((t) => t.clientId === clientId);
}

export function getTasksForCompliance(complianceId: ComplianceId): TaskInstance[] {
  return TASKS.filter((t) => t.complianceId === complianceId);
}

export function daysUntil(dateIso: string): number {
  return Math.round((new Date(dateIso).getTime() - DEMO_TODAY.getTime()) / 86400000);
}

export function complianceName(id: ComplianceId): string {
  return getCompliance(id).shortName;
}
