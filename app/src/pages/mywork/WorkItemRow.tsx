/**
 * IMP-042 (UI slice) — My Work: one work-item row.
 *
 * Renders a DEC-L canonical item truthfully: title, client (when resolvable
 * under the caller's RLS — null renders a dash, never an error), due date
 * (mono/tnum; overdue is flagged against the Asia/Kolkata business date),
 * priority, status, and the item's explicit next_action prominently
 * (DEC-L — a task's stored next_action; the deterministic contract action
 * for standalone returned review items). Waiting items surface their
 * mandatory waiting_reason; Returned items are visually distinct.
 *
 * Task actions are presentation mirrors of the DM-SM-05 edges from the
 * item's CURRENT status, via taskService.transitionTask only (the sole
 * status-change path); reassignment is manager+ only (RLS-TSK-01). The
 * server remains the authorization authority.
 */
import { format } from 'date-fns';
import { ArrowRight, Hourglass, Play, RotateCcw, Send, CheckCheck, UserCog } from 'lucide-react';

import type { MyWorkItem, TransitionTaskInput } from '@/data';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'border-line bg-paper text-ink-2' },
  in_progress: { label: 'In progress', className: 'border-info/30 bg-info-soft text-info' },
  waiting: { label: 'Waiting', className: 'border-warning/30 bg-warning-soft text-warning-strong' },
  submitted: { label: 'In review', className: 'border-violet/30 bg-violet-soft text-violet' },
  returned: { label: 'Returned', className: 'border-critical/30 bg-critical-soft text-critical' },
  approved: { label: 'Approved', className: 'border-success/30 bg-success-soft text-success' },
};

const PRIORITY_META: Record<string, { label: string; className: string }> = {
  high: { label: 'High', className: 'text-critical' },
  medium: { label: 'Medium', className: 'text-warning-strong' },
  normal: { label: 'Normal', className: 'text-ink-3' },
  low: { label: 'Low', className: 'text-ink-3' },
};

export interface TransitionAction {
  key: string;
  label: string;
  icon: typeof Play;
  input: TransitionTaskInput;
  successLabel: string;
  primary?: boolean;
}

/** The DM-SM-05 forward edges offered from each status on My Work. Review
 *  exits (submitted → approved/returned) are four-eyes reviewer-only and
 *  live on the Review Queue — they are intentionally not offered here. */
function transitionsFor(status: string): TransitionAction[] {
  switch (status) {
    case 'open':
      return [
        { key: 'start', label: 'Start', icon: Play, input: { targetStatus: 'in_progress' }, successLabel: 'Task started', primary: true },
      ];
    case 'in_progress':
      return [
        { key: 'submit', label: 'Submit for review', icon: Send, input: { targetStatus: 'submitted' }, successLabel: 'Submitted for review', primary: true },
      ];
    case 'waiting':
      return [
        { key: 'resume', label: 'Resume', icon: Play, input: { targetStatus: 'in_progress' }, successLabel: 'Work resumed', primary: true },
      ];
    case 'returned':
      return [
        { key: 'rework', label: 'Resume rework', icon: RotateCcw, input: { targetStatus: 'in_progress' }, successLabel: 'Rework resumed', primary: true },
      ];
    case 'approved':
      return [
        { key: 'done', label: 'Mark done', icon: CheckCheck, input: { targetStatus: 'done' }, successLabel: 'Task marked done', primary: true },
      ];
    default:
      return [];
  }
}

interface WorkItemRowProps {
  item: MyWorkItem;
  /** The Asia/Kolkata business date 'YYYY-MM-DD' (DEC-L) for the overdue flag. */
  businessDate: string;
  /** RLS-TSK-01 presentation mirror: the reassign control is manager+ only. */
  canReassign: boolean;
  /** A mutation for this item is in flight (API-MUT-02: never optimistic). */
  busy: boolean;
  onTransition: (item: MyWorkItem, action: TransitionAction) => void;
  /** Opens the mandatory waiting-reason dialog (DM-SM-05). */
  onMarkWaiting: (item: MyWorkItem) => void;
  onReassign: (item: MyWorkItem) => void;
}

export default function WorkItemRow({
  item,
  businessDate,
  canReassign,
  busy,
  onTransition,
  onMarkWaiting,
  onReassign,
}: WorkItemRowProps) {
  const status = STATUS_META[item.status] ?? { label: item.status, className: 'border-line bg-paper text-ink-2' };
  const priority = PRIORITY_META[item.priority] ?? { label: item.priority, className: 'text-ink-3' };
  const overdue = item.dueDate !== null && item.dueDate < businessDate && !item.returned;
  const actions = item.kind === 'task' ? transitionsFor(item.status) : [];
  const showWaiting = item.kind === 'task' && item.status === 'in_progress';

  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-card px-4 py-3 shadow-card',
        item.returned && 'border-l-2 border-l-critical',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] leading-5 font-semibold text-ink">{item.title}</p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            {item.clientName ?? '—'}
            {item.kind === 'returned_review' && ' · review item'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.returned && (
            <span className="rounded-full border border-critical/30 bg-critical-soft px-2 py-0.5 text-[10.5px] font-semibold text-critical">
              Returned
            </span>
          )}
          <span className={cn('rounded-full border px-2 py-0.5 text-[10.5px] font-medium', status.className)}>
            {status.label}
          </span>
        </div>
      </div>

      {/* DEC-L: the explicit next action, prominent on every item. */}
      <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-5 text-ink-2">
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} />
        <span>
          <span className="font-medium text-ink">Next:</span> {item.nextAction}
        </span>
      </p>

      {item.status === 'waiting' && item.waitingReason !== null && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-5 text-warning-strong">
          <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {item.waitingReason}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {item.dueDate !== null && (
          <span
            className={cn(
              'font-mono text-[11px] tnum',
              overdue ? 'font-semibold text-critical' : 'text-ink-3',
            )}
          >
            Due {format(new Date(`${item.dueDate}T00:00:00`), 'dd MMM yyyy')}
            {overdue && ' · overdue'}
          </span>
        )}
        <span className={cn('text-[11px] font-medium', priority.className)}>
          {priority.label} priority
        </span>

        {(actions.length > 0 || showWaiting || canReassign) && item.kind === 'task' && (
          <span className="ml-auto flex items-center gap-1.5">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                disabled={busy}
                onClick={() => onTransition(item, action)}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors disabled:opacity-50',
                  action.primary
                    ? 'bg-brand text-white hover:bg-brand-deep'
                    : 'border border-line bg-card text-ink-2 hover:border-brand/40 hover:text-brand',
                )}
              >
                <action.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                {action.label}
              </button>
            ))}
            {showWaiting && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onMarkWaiting(item)}
                className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:border-warning/50 hover:text-warning-strong disabled:opacity-50"
              >
                <Hourglass className="h-3.5 w-3.5" strokeWidth={1.8} />
                Mark waiting…
              </button>
            )}
            {canReassign && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onReassign(item)}
                className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:border-ink-3/50 hover:text-ink disabled:opacity-50"
              >
                <UserCog className="h-3.5 w-3.5" strokeWidth={1.8} />
                Reassign…
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
