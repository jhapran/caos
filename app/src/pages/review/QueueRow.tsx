import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { DEMO_TODAY, getClient, ownerOf } from '@/data';
import type { ReviewItem } from '@/data';
import { cn } from '@/lib/utils';
import { REVIEW_TYPE_META, pseudoRiskScore } from './meta';

export function waitingDays(item: ReviewItem): number {
  return Math.max(0, differenceInCalendarDays(DEMO_TODAY, parseISO(item.submittedAt)));
}

function waitDot(days: number): string {
  if (days > 3) return 'bg-critical';
  if (days >= 2) return 'bg-warning';
  return 'bg-success';
}

/** One review-queue row: type chip, title, submitter caption, risk + waiting badge. */
export default function QueueRow({
  item,
  index,
  selected,
  onSelect,
}: {
  item: ReviewItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const client = getClient(item.clientId);
  const submitter = ownerOf(item.submittedBy);
  const days = waitingDays(item);
  const score = pseudoRiskScore(item.id);
  const Icon = REVIEW_TYPE_META[item.type].icon;

  return (
    <motion.button
      type="button"
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: 'easeOut' }}
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-[10px] border border-line bg-card p-4 text-left shadow-card transition-colors',
        selected ? 'border-brand/30 bg-brand-soft/30' : 'hover:bg-paper-deep/40',
      )}
    >
      {/* Selected: 3px brand left bar */}
      {selected && <motion.span layoutId="review-selected-bar" className="absolute top-3 bottom-3 left-0 w-[3px] rounded-full bg-brand" />}

      {/* Type icon + waiting-age dot */}
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-deep text-ink-2">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        <span className={cn('absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card', waitDot(days))} aria-label={`waiting ${days} days`} />
      </span>

      {/* Title + caption */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-5 font-semibold text-ink">
          {item.title} — {client?.name ?? 'Unknown client'} <span className="font-normal text-ink-3">({item.period})</span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-4 text-ink-3">
          Prepared by {submitter.name} · submitted {days === 0 ? 'today' : `${days}d ago`} · {item.note}
        </span>
      </span>

      {/* Risk chip + waiting badge + chevron */}
      <span className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tnum',
            score >= 70 ? 'bg-critical-soft text-critical' : score >= 50 ? 'bg-warning-soft text-warning-strong' : 'bg-success-soft text-success',
          )}
          title="CAOS risk score"
        >
          {score}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tnum',
            days > 3 ? 'bg-critical-soft text-critical' : days >= 2 ? 'bg-warning-soft text-warning-strong' : 'bg-paper-deep text-ink-2',
          )}
        >
          {days}d
        </span>
        <ChevronRight className={cn('h-4 w-4', selected ? 'text-brand' : 'text-ink-3')} />
      </span>
    </motion.button>
  );
}
