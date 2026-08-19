import { cn } from '@/lib/utils';
import type { TaskCategory, WorkflowState } from '@/data/types';

export type StatusKind =
  | WorkflowState
  | TaskCategory
  | 'At Risk'
  | 'Critical'
  | 'Overdue'
  | 'Pending'
  | 'Approved'
  | 'Returned'
  | 'Ready to File'
  | 'On Track';

interface Palette {
  dot: string;
  bg: string;
  text: string;
}

const MAP: Record<string, Palette> = {
  // success family
  'Filed': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  'Completed': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  'Approved': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  'Acknowledgement Received': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  'Closed': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  'On Track': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  'completed': { dot: 'bg-success', bg: 'bg-success-soft', text: 'text-success' },
  // brand
  'Ready to File': { dot: 'bg-brand', bg: 'bg-brand-soft', text: 'text-brand' },
  // info
  'In Progress': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  'Preparation': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  'Information Received': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  'in-progress': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  'Under Review': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  'Internal Review': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  'under-review': { dot: 'bg-info', bg: 'bg-info-soft', text: 'text-info' },
  // warning
  'Waiting for Client': { dot: 'bg-warning', bg: 'bg-warning-soft', text: 'text-warning' },
  'Information Requested': { dot: 'bg-warning', bg: 'bg-warning-soft', text: 'text-warning' },
  'Client Approval': { dot: 'bg-warning', bg: 'bg-warning-soft', text: 'text-warning' },
  'waiting': { dot: 'bg-warning', bg: 'bg-warning-soft', text: 'text-warning' },
  'Pending': { dot: 'bg-warning', bg: 'bg-warning-soft', text: 'text-warning' },
  // at risk (strong amber chip)
  'At Risk': { dot: 'bg-warning-strong', bg: 'bg-warning-soft', text: 'text-warning-strong' },
  // critical
  'Critical': { dot: 'bg-critical', bg: 'bg-critical-soft', text: 'text-critical' },
  'Overdue': { dot: 'bg-critical', bg: 'bg-critical-soft', text: 'text-critical' },
  'Returned': { dot: 'bg-critical', bg: 'bg-critical-soft', text: 'text-critical' },
  // neutral
  'Not Started': { dot: 'bg-ink-3', bg: 'bg-paper-deep', text: 'text-ink-2' },
  'not-started': { dot: 'bg-ink-3', bg: 'bg-paper-deep', text: 'text-ink-2' },
};

const NEUTRAL: Palette = { dot: 'bg-ink-3', bg: 'bg-paper-deep', text: 'text-ink-2' };

export function statusPalette(status: string): Palette {
  return MAP[status] ?? NEUTRAL;
}

export default function StatusPill({
  status,
  size = 'md',
  className,
}: {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const p = statusPalette(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px] leading-4' : 'px-2.5 py-1 text-[12px] leading-4',
        p.bg,
        p.text,
        className,
      )}
    >
      <span className={cn('rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2', p.dot)} />
      {status}
    </span>
  );
}
