import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import CountUp from '@/components/CountUp';
import { useLiveAggregates } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

interface Segment {
  key: string;
  label: string;
  value: number;
  bar: string;
  dot: string;
  to: string;
  hint: string;
}

/**
 * Section A — Compliance Health. Hero active count + segmented progress bar
 * (Completed / In Progress / Waiting / Under Review / At Risk) + drillable
 * mini-stat chips. Counts come from the live aggregates so drill-downs reconcile.
 */
export default function ComplianceHealth({ delay = 0 }: { delay?: number }) {
  const agg = useLiveAggregates();
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);

  const segments: Segment[] = [
    {
      key: 'completed', label: 'Completed', value: agg.completed,
      bar: 'bg-brand', dot: 'bg-brand', to: '/deadlines?status=completed',
      hint: `${agg.completed} compliances filed, acknowledged or closed this FY`,
    },
    {
      key: 'in-progress', label: 'In Progress', value: agg.inProgress,
      bar: 'bg-info', dot: 'bg-info', to: '/deadlines?status=in-progress',
      hint: `${agg.inProgress} compliances in preparation across the firm`,
    },
    {
      key: 'waiting', label: 'Waiting for Client', value: agg.waiting,
      bar: 'bg-warning', dot: 'bg-warning', to: '/dependency',
      hint: `${agg.waiting} compliances across 28 clients awaiting documents`,
    },
    {
      key: 'under-review', label: 'Under Review', value: agg.underReview,
      bar: 'bg-violet', dot: 'bg-violet', to: '/review',
      hint: `${agg.underReview} compliances in internal or partner review`,
    },
    {
      key: 'at-risk', label: 'At Risk', value: agg.atRisk,
      bar: 'bg-critical', dot: 'bg-critical', to: '/deadlines?status=at-risk',
      hint: `${agg.atRisk} compliances at risk of missing a statutory date`,
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Compliance Health"
      className="rounded-xl border border-line bg-card p-6 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">Compliance Health</h2>
        <span className="text-caption normal-case">All active engagements · FY 2024-25</span>
      </div>

      {/* Hero number */}
      <div className="mt-4 flex items-end gap-3">
        <span className="text-stat-xl text-ink">
          <CountUp value={agg.active} duration={1} />
        </span>
        <span className="pb-1.5 text-[13px] leading-5 text-ink-2">active compliances</span>
      </div>

      {/* Segmented progress bar — segments grow via scaleX (GPU) inside fixed-width slots */}
      <div className="mt-4 flex h-3 w-full gap-px overflow-hidden rounded-full bg-paper-deep" role="img"
        aria-label={`${agg.completed} completed, ${agg.inProgress} in progress, ${agg.waiting} waiting for client, ${agg.underReview} under review, ${agg.atRisk} at risk`}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            style={{ width: `${(s.value / agg.active) * 100}%` }}
            onMouseEnter={() => setHovered(s.key)}
            onMouseLeave={() => setHovered(null)}
            title={s.hint}
            className="h-full"
          >
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, delay: delay + 0.2 + i * 0.1, ease: 'easeOut' }}
              className={cn('h-full w-full origin-left', s.bar)}
            />
          </div>
        ))}
      </div>

      {/* Mini-stat chips — every number drills */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {segments.map((s, i) => (
          <motion.button
            key={s.key}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: delay + 0.3 + i * 0.06, ease: EASE }}
            onClick={() => navigate(s.to)}
            onMouseEnter={() => setHovered(s.key)}
            onMouseLeave={() => setHovered(null)}
            title={s.hint}
            className={cn(
              'flex items-center gap-2.5 rounded-lg border border-line bg-paper px-3 py-2.5 text-left transition-all duration-200',
              'hover:-translate-y-px hover:border-ink-3/40 hover:shadow-card',
              hovered === s.key && 'border-gold/60 ring-2 ring-gold/25',
            )}
          >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', s.dot)} />
            <span className="min-w-0">
              <span className="block font-mono text-[15px] leading-5 font-medium text-ink tnum">
                <CountUp value={s.value} duration={0.9} />
              </span>
              <span className="block truncate text-[11px] leading-4 font-medium tracking-[0.04em] text-ink-3 uppercase">
                {s.label}
              </span>
            </span>
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}
