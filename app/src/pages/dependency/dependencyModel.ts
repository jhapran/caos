// Page-local derivations for the Client Dependency page (client-dependency.md).
// All headline numbers reconcile with @/data (48 clients / 79 blocked tasks).

import { format } from 'date-fns';
import { getClient, ownerOf, getTasks, DEMO_TODAY } from '@/data';
import type { DependencyClient } from '@/data';

/** Documents outstanding across the firm (doc-type matrix below sums to this). */
export const DOC_TOTAL = 112;

export interface DocMatrixRow {
  id: string;
  label: string;
  count: number;
  /** substring matched against DependencyClient.missingDocs; 'other' = none of the known keywords */
  keyword: string;
  mostDelayed: string;
  medianDays: number;
}

export const DOC_MATRIX: DocMatrixRow[] = [
  { id: 'bank', label: 'Bank statements', count: 38, keyword: 'bank', mostDelayed: 'ABC Pvt Ltd', medianDays: 5.1 },
  { id: 'purchase', label: 'Purchase registers', count: 26, keyword: 'purchase', mostDelayed: 'XYZ LLP', medianDays: 3.8 },
  { id: 'sales', label: 'Sales registers', count: 17, keyword: 'sales', mostDelayed: 'PQR Industries', medianDays: 3.2 },
  { id: 'letters', label: 'Signed engagement letters', count: 4, keyword: 'engagement', mostDelayed: 'RST Pvt Ltd', medianDays: 6.4 },
  { id: 'dsc', label: 'DSC renewals', count: 7, keyword: 'dsc', mostDelayed: 'Kaveri Textiles Pvt Ltd', medianDays: 4.6 },
  { id: 'other', label: 'Other', count: 20, keyword: 'other', mostDelayed: 'Meridian Exports', medianDays: 2.9 },
];

const KNOWN_KEYWORDS = ['bank', 'purchase', 'sales', 'engagement', 'dsc'];

export function matchesDocFilter(d: DependencyClient, keyword: string): boolean {
  const docs = d.missingDocs.map((x) => x.toLowerCase());
  if (keyword === 'other') {
    return docs.length > 0 && docs.every((doc) => !KNOWN_KEYWORDS.some((k) => doc.includes(k)));
  }
  return docs.some((doc) => doc.includes(keyword));
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic seeded reminder count (1–3) before any live sends. */
export function baseReminderCount(clientId: string): number {
  return 1 + (hash(clientId) % 3);
}

/** "Missing items" shown on podium cards — headline blockers read 7 / 5 / 4. */
export function missingItems(d: DependencyClient): number {
  return Math.max(d.missingDocs.length, Math.min(7, d.blockingTasks));
}

export function entityCaption(clientId: string): string {
  const c = getClient(clientId);
  return c ? `${c.entityType} · ${c.city}` : 'Extended portfolio';
}

interface Contact {
  name: string;
  role: string;
  channel: 'WhatsApp' | 'Email';
}

const CONTACTS: Record<string, Contact> = {
  'c-abc': { name: 'Rakesh Mehta', role: 'CFO', channel: 'WhatsApp' },
  'c-xyz': { name: 'Ananya Krishnan', role: 'Finance Head', channel: 'WhatsApp' },
  'c-pqr': { name: 'Suresh Pillai', role: 'Director', channel: 'Email' },
  'c-lmn': { name: 'Kavita Deshmukh', role: 'Company Secretary', channel: 'Email' },
  'c-rst': { name: 'Nitin Shah', role: 'Managing Director', channel: 'WhatsApp' },
};

const CONTACT_POOL: Contact[] = [
  { name: 'Meera Joshi', role: 'Accounts Manager', channel: 'WhatsApp' },
  { name: 'Arvind Rao', role: 'Proprietor', channel: 'WhatsApp' },
  { name: 'Fatima Sheikh', role: 'Finance Controller', channel: 'Email' },
  { name: 'Deepak Kulkarni', role: 'Partner', channel: 'WhatsApp' },
  { name: 'Shalini Menon', role: 'Trustee', channel: 'Email' },
  { name: 'Vikram Chawla', role: 'Director', channel: 'WhatsApp' },
];

export function contactFor(clientId: string): Contact {
  return CONTACTS[clientId] ?? CONTACT_POOL[hash(clientId) % CONTACT_POOL.length];
}

export function ownerName(ownerId: string): string {
  return ownerOf(ownerId).name;
}

export function fmtDay(iso?: string): string {
  if (!iso) return '—';
  return format(new Date(iso), 'dd MMM');
}

export function fmtDateTime(iso: string): string {
  return format(new Date(iso), 'dd MMM, hh:mm a');
}

/** Nearest actionable due date for a client (for the reminder merge field). */
export function nextDueLabel(clientId: string): string {
  const pending = getTasks({ clientId })
    .filter((t) => t.category !== 'completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (pending.length === 0) return format(new Date(DEMO_TODAY.getTime() + 3 * 86400000), 'dd MMM yyyy');
  return format(new Date(pending[0].dueDate), 'dd MMM yyyy');
}

export function buildReminderMessage(clientName: string, docs: string[], clientId: string): string {
  const list = (docs.length > 0 ? docs : ['pending information']).map((d) => `• ${d}`).join('\n');
  return `Namaste ${clientName} team,\n\nGentle reminder from LK Associates — we are awaiting the following to keep your filings on track:\n\n${list}\n\nPlease share by ${nextDueLabel(clientId)}. You can reply on this thread or WhatsApp the documents directly.\n\n— CA Lew Kong`;
}

export function averageWait(clients: DependencyClient[]): number {
  if (clients.length === 0) return 0;
  return clients.reduce((s, c) => s + c.oldestWaitDays, 0) / clients.length;
}
