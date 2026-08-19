// Page-local helpers shared by the deadlines board, drill-down, and compliance detail.
import { format } from 'date-fns';
import type { LucideIcon } from 'lucide-react';
import { Building2, ClipboardCheck, FileText, Landmark, Receipt, Users } from 'lucide-react';
import { DEMO_TODAY } from '@/data';
import type { DeadlineGroup } from '@/data';

/** "11 Sep 2025" */
export const fmtDate = (iso: string): string => format(new Date(iso), 'd MMM yyyy');

/** "3 days ago" relative to the frozen demo clock (09 Sep 2025). */
export function relTo(iso: string): string {
  const days = Math.round((DEMO_TODAY.getTime() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "Due in 3 days" / "Overdue by 2 days" relative to the demo clock. */
export function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Overdue by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}`;
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

/** "Ready" reconciles the chips to the Clients column: everything not blocked / at risk. */
export function groupReady(g: DeadlineGroup): number {
  return Math.max(0, g.totalClients - g.waiting - g.atRisk);
}

/** Deterministic icon per compliance category (Lucide only — design.md §Assets). */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  GST: Receipt,
  TDS: Landmark,
  'Income Tax': FileText,
  Audit: ClipboardCheck,
  MCA: Building2,
  Payroll: Users,
};

/** Risk score → semantic text color (mono numerals in tables). */
export function riskTextClass(score: number): string {
  if (score >= 70) return 'text-critical';
  if (score >= 40) return 'text-warning-strong';
  return 'text-success';
}

/** Demo-clock "now" for locally generated events (keeps timestamps on 09 Sep 2025). */
export function demoNowIso(offsetMinutes = 0): string {
  return new Date(DEMO_TODAY.getTime() + 3 * 3600000 + offsetMinutes * 60000).toISOString();
}

/** Join a list Indian-style: "a, b + c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} + ${items[items.length - 1]}`;
}
