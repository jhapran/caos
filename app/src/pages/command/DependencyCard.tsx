import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BellRing, Check } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { useDemoStore, useLiveAggregates } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/**
 * Section C — Client Dependency. Top blockers with one-click nudges
 * (toast via the demo store); banner reconciles with DEPENDENCY_TOTALS.
 */
export default function DependencyCard({ delay = 0 }: { delay?: number }) {
  const { dependencyClients, sendReminder } = useDemoStore();
  const agg = useLiveAggregates();
  const [nudged, setNudged] = useState<Record<string, boolean>>({});

  const top = [...dependencyClients].sort((a, b) => b.blockingTasks - a.blockingTasks).slice(0, 3);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Client Dependency"
      className="rounded-xl border border-line bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">Client Dependency</h2>
        <Link
          to="/dependency"
          className="gold-underline-sweep flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-deep"
        >
          See all {agg.dependencyClients} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="px-5 pt-1.5 text-[14px] leading-5 font-semibold text-warning-strong">
        {agg.dependencyClients} clients currently blocking {agg.dependencyTasks} compliance tasks.
      </p>
      <p className="px-5 text-[12px] leading-4 text-ink-3">Documents requested but not received.</p>

      <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {top.map((c, i) => (
          <motion.li
            key={c.clientId}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: delay + 0.15 + i * 0.08, ease: EASE }}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-soft/40"
          >
            <Avatar name={c.clientName} size="sm" />
            <div className="min-w-0 flex-1">
              <Link
                to={`/dependency?client=${c.clientId}`}
                className="block truncate text-[13.5px] leading-5 font-semibold text-ink hover:text-brand"
              >
                {c.clientName}
              </Link>
              <span className="block text-[12px] leading-4 text-ink-3">
                {c.blockingTasks} missing items · oldest request {c.oldestWaitDays} days ago
              </span>
            </div>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-warning-soft px-1.5 font-mono text-[12px] font-semibold text-warning-strong tnum">
              {c.blockingTasks}
            </span>
            <button
              type="button"
              disabled={nudged[c.clientId]}
              onClick={() => {
                sendReminder(c.clientId);
                setNudged((s) => ({ ...s, [c.clientId]: true }));
              }}
              className={cn(
                'flex w-[76px] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all',
                nudged[c.clientId]
                  ? 'border-success/40 bg-success-soft text-success'
                  : 'border-line bg-card text-ink-2 hover:border-brand/40 hover:text-brand',
              )}
            >
              {nudged[c.clientId] ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Sent
                </>
              ) : (
                <>
                  <BellRing className="h-3.5 w-3.5" /> Nudge
                </>
              )}
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.section>
  );
}
