import { Check } from 'lucide-react';
import { WORKFLOW_STATES } from '@/data/types';
import type { WorkflowEvent, WorkflowState } from '@/data/types';
import { cn } from '@/lib/utils';

/**
 * WorkflowStepper — horizontal 10-state pipeline. Completed nodes brand with
 * check, current node pulsing gold ring, future nodes line-gray.
 * Node title carries timestamp + actor tooltip.
 */
export default function WorkflowStepper({
  current,
  history = [],
  compact = false,
}: {
  current: WorkflowState;
  history?: WorkflowEvent[];
  compact?: boolean;
}) {
  const currentIdx = WORKFLOW_STATES.indexOf(current);
  const eventFor = (s: WorkflowState) => history.find((h) => h.state === s);

  return (
    <ol className="flex w-full items-start" aria-label="Workflow progress">
      {WORKFLOW_STATES.map((state, i) => {
        const done = i < currentIdx;
        const isCurrent = i === currentIdx;
        const ev = eventFor(state);
        const tooltip = ev
          ? `${state} — ${new Date(ev.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${ev.actor}`
          : state;
        return (
          <li key={state} className={cn('relative flex-1', i === WORKFLOW_STATES.length - 1 && 'flex-none')}>
            {i < WORKFLOW_STATES.length - 1 && (
              <div
                className={cn(
                  'absolute top-[9px] left-[18px] h-px w-[calc(100%-18px)]',
                  done || isCurrent ? 'bg-brand' : 'bg-line',
                )}
              />
            )}
            <div className="relative flex flex-col items-center gap-1.5" title={tooltip}>
              <span
                className={cn(
                  'relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border',
                  done && 'border-brand bg-brand text-white',
                  isCurrent && 'border-gold bg-card',
                  !done && !isCurrent && 'border-line bg-card',
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : isCurrent ? (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
                  </span>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-line" />
                )}
              </span>
              {!compact && (
                <span
                  className={cn(
                    'max-w-[88px] text-center text-[10px] leading-3',
                    isCurrent ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-ink-3',
                  )}
                >
                  {state}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
