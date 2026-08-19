// Typed API surface for page agents. All reads are synchronous fixtures wrapped
// in simulated latency (150–400 ms) so drill-downs show subtle loading states.

import { ALERTS } from './alerts';
import { CLIENTS, FIRM, getClient, ownerOf, TEAM } from './clients';
import { COMPLIANCE_MASTER } from './compliance';
import { getDeadlineClients, getDeadlineGroup, getDeadlineGroups } from './deadlines';
import { DEPENDENCY_CLIENTS } from './dependency';
import { matchAskQuery } from './askCaos';
import { REVIEW_ITEMS } from './review';
import { AGGREGATES, getTask, getTasksForCompliance, TASKS } from './tasks';
import type { AskAnswer, Client, ComplianceId, TaskCategory, TaskInstance } from './types';

/** Wrap any value in a 150–400 ms simulated latency promise. */
export function withLatency<T>(value: T, min = 150, max = 400): Promise<T> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// --- static reads (sync) ---
export const getFirm = () => FIRM;
export const getTeam = () => TEAM;
export const getClients = (): Client[] => CLIENTS;
export const getComplianceMaster = () => COMPLIANCE_MASTER;
export const getAggregates = () => AGGREGATES;
export const getTasks = (filter?: { clientId?: string; complianceId?: ComplianceId; category?: TaskCategory }): TaskInstance[] => {
  let out = TASKS;
  if (filter?.clientId) out = out.filter((t) => t.clientId === filter.clientId);
  if (filter?.complianceId) out = out.filter((t) => t.complianceId === filter.complianceId);
  if (filter?.category) out = out.filter((t) => t.category === filter.category);
  return out;
};

// --- async reads (simulated latency) ---
export const fetchClients = () => withLatency(CLIENTS);
export const fetchAggregates = () => withLatency(AGGREGATES);
export const fetchTasks = (filter?: Parameters<typeof getTasks>[0]) => withLatency(getTasks(filter));
export const fetchTask = (id: string) => withLatency(getTask(id));
export const fetchClient = (id: string) => withLatency(getClient(id));
export const fetchDeadlines = () => withLatency(getDeadlineGroups());
export const fetchDeadline = (id: string) => withLatency(getDeadlineGroup(id));
export const fetchDeadlineClients = (id: string) => withLatency(getDeadlineClients(id));
export const fetchComplianceTasks = (id: ComplianceId) => withLatency(getTasksForCompliance(id));
export const fetchReviewItems = () => withLatency(REVIEW_ITEMS);
export const fetchAlerts = () => withLatency(ALERTS);
export const fetchDependencyClients = () => withLatency(DEPENDENCY_CLIENTS);

/** Ask CAOS: resolves a canned structured answer (or fallback) after latency. */
export const askCaos = (query: string): Promise<AskAnswer> =>
  withLatency(matchAskQuery(query), 400, 900);

// --- ⌘K command palette search ---
export interface SearchHit {
  kind: 'client' | 'compliance' | 'page';
  id: string;
  label: string;
  sub: string;
  href: string;
}

const PAGES: SearchHit[] = [
  { kind: 'page', id: 'p-brief', label: 'Morning Brief', sub: 'Partner view', href: '/brief' },
  { kind: 'page', id: 'p-command', label: 'Command Centre', sub: 'Sections A–E', href: '/command' },
  { kind: 'page', id: 'p-deadlines', label: 'Deadlines', sub: 'Full board', href: '/deadlines' },
  { kind: 'page', id: 'p-review', label: 'Review Queue', sub: '21 items', href: '/review' },
  { kind: 'page', id: 'p-dependency', label: 'Client Dependency', sub: '48 clients', href: '/dependency' },
  { kind: 'page', id: 'p-alerts', label: 'Risk Alerts', sub: '5 active', href: '/alerts' },
  { kind: 'page', id: 'p-ask', label: 'Ask CAOS', sub: 'Ask in English', href: '/ask' },
  { kind: 'page', id: 'p-reports', label: 'Reports', sub: 'Board-ready snapshot', href: '/reports' },
];

export function searchAll(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return PAGES.slice(0, 4);
  const clients: SearchHit[] = CLIENTS.filter((c) => c.name.toLowerCase().includes(q))
    .slice(0, 6)
    .map((c) => ({ kind: 'client', id: c.id, label: c.name, sub: `${c.industry} · ${c.city} · ${ownerOf(c.ownerId).name}`, href: `/compliance/${c.id}` }));
  const comps: SearchHit[] = COMPLIANCE_MASTER.filter((m) => m.name.toLowerCase().includes(q) || m.shortName.toLowerCase().includes(q))
    .slice(0, 4)
    .map((m) => ({ kind: 'compliance', id: m.id, label: m.name, sub: `${m.category} · ${m.frequency} · due ${m.dueRule}`, href: `/deadlines?c=${m.id}` }));
  const pages = PAGES.filter((p) => p.label.toLowerCase().includes(q));
  return [...clients, ...comps, ...pages].slice(0, 10);
}

// NOTE: fixture constants (CLIENTS, TASKS, ALERTS, …) are re-exported from
// their own modules via ./index — import everything from '@/data'.
