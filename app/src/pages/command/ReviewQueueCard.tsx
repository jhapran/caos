import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeftRight, ArrowRight, ClipboardCheck, FileSpreadsheet, IndianRupee, Percent } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import CountUp from '@/components/CountUp';
import { DEMO_TODAY, getClient, useDemoStore } from '@/data';
import type { ReviewType } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TYPE_META: { type: ReviewType; slug: string; icon: LucideIcon }[] = [
  { type: 'GST Reconciliation', slug: 'gst-reconciliation', icon: ArrowLeftRight },
  { type: 'TDS', slug: 'tds', icon: Percent },
  { type: 'ITR', slug: 'itr', icon: IndianRupee },
  { type: 'Financial Statements', slug: 'financial-statements', icon: FileSpreadsheet },
  { type: 'Audit Workpaper', slug: 'audit-workpaper', icon: ClipboardCheck },
];

/**
 * Section D — Review Queue summary (right rail). Type breakdown meters +
 * oldest-item callout; counts are live from the demo store.
 */
export default function ReviewQueueCard({ delay = 0 }: { delay?: number }) {
  const { reviewItems, reviewPendingCount } = useDemoStore();

  const pending = useMemo(() => reviewItems.filter((r) => r.status === 'pending'), [reviewItems]);
  const counts = useMemo(() => {
    const m = new Map<ReviewType, number>();
    for (const r of pending) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [pending]);
  const maxCount = Math.max(1, ...counts.values());

  const oldest = useMemo(() => {
    if (!pending.length) return null;
    const item = [...pending].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];
    const days = Math.max(0, Math.floor((DEMO_TODAY.getTime() - new Date(item.submittedAt).getTime()) / 86400000));
    return { item, days, client: getClient(item.clientId) };
  }, [pending]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Review Queue"
      className="rounded-xl border border-line bg-card p-5 shadow-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">Review Queue</h2>
        <Link
          to="/review"
          className="gold-underline-sweep flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-deep"
        >
          Open queue <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="mt-1 text-[12px] leading-4 font-medium text-violet">
        {reviewPendingCount} items awaiting review
      </p>

      <ul className="mt-4 space-y-3">
        {TYPE_META.map(({ type, slug, icon: Icon }, i) => {
          const count = counts.get(type) ?? 0;
          return (
            <li key={type}>
              <Link to={`/review?type=${slug}`} className="group block">
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-ink-3 transition-colors group-hover:text-brand" strokeWidth={1.8} />
                  <span className="flex-1 truncate text-[13px] leading-5 text-ink-2 transition-colors group-hover:text-ink">
                    {type}
                  </span>
                  <span className="font-mono text-[13px] leading-5 font-medium text-ink tnum">
                    <CountUp value={count} duration={0.7} />
                  </span>
                </span>
                <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-paper-deep">
                  <motion.span
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: count / maxCount }}
                    transition={{ duration: 0.7, delay: delay + 0.2 + i * 0.06, ease: 'easeOut' }}
                    className={cn('block h-full w-full origin-left rounded-full', count > 0 ? 'bg-brand' : 'bg-line')}
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {oldest && (
        <p className="mt-4 border-t border-line/70 pt-3 text-[12px] leading-4 text-ink-3">
          Oldest waiting: <span className={cn('font-semibold', oldest.days >= 4 ? 'text-warning-strong' : 'text-ink-2')}>{oldest.days} days</span>
          {' '}— {oldest.client?.name ?? 'client'} {oldest.item.type.toLowerCase()}
        </p>
      )}
    </motion.section>
  );
}
