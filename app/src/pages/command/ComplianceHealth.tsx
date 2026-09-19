import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import CountUp from '@/components/CountUp';
import { getDataSource, OPEN_INSTANCE_STATES, useLiveAggregates } from '@/data';
import type { ComplianceInstanceState } from '@/data';
import type { DashboardAggregatesState } from '@/hooks/useDashboardAggregates';
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
 *
 * IMP-060 (H1): in live (Supabase) mode the health model is the live
 * compliance_instances DM-SM-04 state truth (complianceInstanceCountsByState)
 * — fixture task-category semantics are NOT the live definition. The At Risk
 * chip is the IMP-051 deadline_board at-risk derivation and sits OUTSIDE the
 * state partition (it overlaps it).
 */
export default function ComplianceHealth({
  delay = 0,
  dashboard,
}: {
  delay?: number;
  /** IMP-060: the page-composed aggregate state (ONE composition per page). */
  dashboard: DashboardAggregatesState;
}) {
  if (getDataSource() !== 'supabase') return <FixtureComplianceHealth delay={delay} />;
  return <LiveComplianceHealth delay={delay} dashboard={dashboard} />;
}

/** Fixture/demo track — unchanged. */
function FixtureComplianceHealth({ delay }: { delay: number }) {
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

/** H1 live segment definitions: DM-SM-04 state groups (they partition the
 *  ten-state pipeline, so the proportion bar reconciles with the total). */
const LIVE_SEGMENTS: {
  key: string;
  label: string;
  states: ComplianceInstanceState[];
  bar: string;
  dot: string;
  to: string;
  hint: string;
}[] = [
  {
    key: 'not-started', label: 'Not Started', states: ['not_started'],
    bar: 'bg-ink-3/60', dot: 'bg-ink-3', to: '/deadlines',
    hint: 'Obligations not yet started',
  },
  {
    key: 'waiting', label: 'Waiting for Client', states: ['information_requested'],
    bar: 'bg-warning', dot: 'bg-warning', to: '/deadlines',
    hint: 'Obligations awaiting client information',
  },
  {
    key: 'in-progress', label: 'In Progress', states: ['information_received', 'preparation'],
    bar: 'bg-info', dot: 'bg-info', to: '/deadlines',
    hint: 'Obligations in preparation',
  },
  {
    key: 'under-review', label: 'Under Review', states: ['internal_review', 'client_approval'],
    bar: 'bg-violet', dot: 'bg-violet', to: '/review',
    hint: 'Obligations in internal or client review',
  },
  {
    key: 'ready', label: 'Ready to File', states: ['ready_to_file'],
    bar: 'bg-gold', dot: 'bg-gold', to: '/deadlines',
    hint: 'Obligations ready to file',
  },
  {
    key: 'completed', label: 'Completed', states: ['filed', 'acknowledgement_received', 'closed'],
    bar: 'bg-brand', dot: 'bg-brand', to: '/deadlines',
    hint: 'Obligations filed, acknowledged or closed',
  },
];

/** Live (Supabase) track — the DM-SM-04 state truth; the aggregate state is
 *  composed ONCE by the page and received as a prop. */
function LiveComplianceHealth({
  delay,
  dashboard,
}: {
  delay: number;
  dashboard: DashboardAggregatesState;
}) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);
  const { aggregates, loading, error, refetch } = dashboard;

  if (loading) {
    return (
      <section
        aria-label="Compliance Health"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-16 text-center"
      >
        <p className="text-[14px] font-medium text-ink">Loading…</p>
        <p className="mt-1 text-[13px] text-ink-3">Reading live compliance states.</p>
      </section>
    );
  }
  if (error || !aggregates) {
    return (
      <section
        aria-label="Compliance Health"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-16 text-center"
      >
        <p className="text-[14px] font-medium text-ink">Could not load compliance health</p>
        <p className="mt-1 text-[13px] text-ink-3">{error?.message ?? 'The live read failed.'}</p>
        <button
          type="button"
          onClick={refetch}
          className="mt-4 rounded-lg border border-line bg-card px-4 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
        >
          Retry
        </button>
      </section>
    );
  }

  const counts = aggregates.complianceInstanceCountsByState;
  const open = OPEN_INSTANCE_STATES.reduce((sum, s) => sum + counts[s], 0);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const segments: Segment[] = LIVE_SEGMENTS.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.states.reduce((sum, st) => sum + counts[st], 0),
    bar: s.bar,
    dot: s.dot,
    to: s.to,
    hint: s.hint,
  }));
  const atRisk = aggregates.atRiskDeadlines;
  const ariaSummary =
    segments.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ') +
    `, ${atRisk} at risk`;

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
        <span className="text-caption normal-case">Live compliance-instance states</span>
      </div>

      {/* Hero number — open (pre-closure) obligations, DM-SM-04 */}
      <div className="mt-4 flex items-end gap-3">
        <span className="text-stat-xl text-ink">
          <CountUp value={open} duration={1} />
        </span>
        <span className="pb-1.5 text-[13px] leading-5 text-ink-2">open compliance obligations</span>
      </div>

      {/* Segmented progress bar — the six state groups partition the total */}
      <div className="mt-4 flex h-3 w-full gap-px overflow-hidden rounded-full bg-paper-deep" role="img"
        aria-label={ariaSummary}>
        {segments.map((s, i) => (
          <div
            key={s.key}
            style={{ width: total > 0 ? `${(s.value / total) * 100}%` : 0 }}
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

      {/* Mini-stat chips — every number drills. At Risk is the deadline_board
          derivation and overlaps the state partition, so it is NOT a bar segment. */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
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
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: delay + 0.3 + segments.length * 0.06, ease: EASE }}
          onClick={() => navigate('/deadlines')}
          onMouseEnter={() => setHovered('at-risk')}
          onMouseLeave={() => setHovered(null)}
          title={`${atRisk} obligations at risk of missing a statutory date`}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border border-critical/30 bg-critical-soft/60 px-3 py-2.5 text-left transition-all duration-200',
            'hover:-translate-y-px hover:border-critical/50 hover:shadow-card',
            hovered === 'at-risk' && 'border-gold/60 ring-2 ring-gold/25',
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-critical" />
          <span className="min-w-0">
            <span className="block font-mono text-[15px] leading-5 font-medium text-critical tnum">
              <CountUp value={atRisk} duration={0.9} />
            </span>
            <span className="block truncate text-[11px] leading-4 font-medium tracking-[0.04em] text-critical/80 uppercase">
              At Risk
            </span>
          </span>
        </motion.button>
      </div>
    </motion.section>
  );
}
