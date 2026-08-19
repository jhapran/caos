import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import Avatar from '@/components/Avatar';
import CountUp from '@/components/CountUp';
import DeadlineRing from '@/components/DeadlineRing';
import { useDemoStore, useLiveAggregates } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Team overload narrative (PRD §137): three associates past capacity threshold. */
const OVERLOADED = [
  { name: 'Rahul Verma', load: 92, note: 'Rahul Verma: 23 open tasks · 4 overdue' },
  { name: 'Neha Iyer', load: 88, note: 'Neha Iyer: 19 open tasks · 2 overdue' },
  { name: 'Amit Shah', load: 85, note: 'Amit Shah: 17 open tasks · 1 overdue' },
];

/** Upcoming statutory windows (PRD §137 posture readout). */
const NEXT_DEADLINES = [
  { label: 'GST filings', caption: 'GSTR-1 / GSTR-3B cycle', days: 5 },
  { label: 'TDS returns', caption: '24Q / 26Q quarter', days: 12 },
  { label: 'MCA annual', caption: 'AOC-4 / MGT-7 season', days: 18 },
];

function BriefCard({
  label,
  to,
  footer,
  delay,
  amber = false,
  children,
}: {
  label: string;
  to: string;
  footer: string;
  delay: number;
  amber?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      onClick={() => navigate(to)}
      className={cn(
        'group flex h-full flex-col rounded-xl border border-line bg-card p-5 text-left shadow-card transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-lift',
        amber && 'border-l-[3px] border-l-warning',
      )}
    >
      <span className="text-caption">{label}</span>
      <span className="mt-2.5 flex-1">{children}</span>
      <span className="mt-3 flex items-center gap-1 text-[12px] leading-4 font-medium text-brand">
        {footer}
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-[3px] group-hover:-translate-y-[1px]" />
      </span>
    </motion.button>
  );
}

/** Section 2 — the six-tile brief grid (3×2 on desktop), every tile click-through. */
export default function BriefCards() {
  const agg = useLiveAggregates();
  const { reviewItems } = useDemoStore();
  const needsMe = reviewItems.filter((r) => r.status === 'pending' && r.priority !== 'low').length;

  return (
    <section aria-label="Brief summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {/* 1 — Compliance Risk */}
      <BriefCard label="Compliance Risk" to="/command" footer="Open Command Centre" delay={0.1}>
        <span className="flex flex-wrap items-baseline gap-x-2 text-[20px] leading-7 font-semibold tnum">
          <span className="text-critical"><CountUp value={5} duration={0.8} /> Critical</span>
          <span className="text-ink-3">·</span>
          <span className="text-warning-strong"><CountUp value={12} duration={0.8} /> At Risk</span>
        </span>
        <span className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-paper-deep" aria-hidden>
          <span className="h-full bg-critical" style={{ width: '3%' }} />
          <span className="h-full bg-warning" style={{ width: '5%' }} />
          <span className="h-full bg-success" style={{ width: '92%' }} />
        </span>
        <span className="mt-2 block text-[12px] leading-4 text-ink-3">684 engagements on track</span>
      </BriefCard>

      {/* 2 — Waiting for Clients */}
      <BriefCard label="Waiting for Clients" to="/dependency" footer="Open Client Dependency" delay={0.17}>
        <span className="flex items-baseline gap-2">
          <span className="text-stat-xl text-ink"><CountUp value={28} duration={0.8} /></span>
          <span className="text-[13px] text-ink-2">clients owe documents</span>
        </span>
        <span className="mt-2 block text-[12px] leading-4 text-ink-3">
          {agg.dependencyClients} clients blocking {agg.dependencyTasks} tasks firm-wide
        </span>
      </BriefCard>

      {/* 3 — Awaiting Review */}
      <BriefCard label="Awaiting Review" to="/review" footer="Open Review Queue" delay={0.24}>
        <span className="flex items-baseline gap-2">
          <span className="text-stat-xl text-ink"><CountUp value={needsMe} duration={0.8} /></span>
          <span className="text-[13px] text-ink-2">items need partner sign-off</span>
        </span>
        <span className="mt-2 block text-[12px] leading-4 text-ink-3">{agg.reviewPending} in the full queue</span>
      </BriefCard>

      {/* 4 — Team Overload */}
      <BriefCard label="Team Overload" to="/alerts" footer="Open Risk Alerts" delay={0.31}>
        <span className="flex items-baseline gap-2">
          <span className="text-stat-xl text-ink"><CountUp value={3} duration={0.8} /></span>
          <span className="text-[13px] text-ink-2">employees past capacity</span>
        </span>
        <span className="mt-3 block space-y-2">
          {OVERLOADED.map((m) => (
            <span key={m.name} className="flex items-center gap-2" title={m.note}>
              <Avatar name={m.name} size="xs" />
              <span className="w-20 truncate text-[12px] leading-4 text-ink-2">{m.name.split(' ')[0]}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-deep">
                <span className="block h-full rounded-full bg-warning" style={{ width: `${m.load}%` }} />
              </span>
              <span className="font-mono text-[11px] leading-4 text-warning-strong tnum">{m.load}%</span>
            </span>
          ))}
        </span>
      </BriefCard>

      {/* 5 — Upcoming Deadlines */}
      <BriefCard label="Upcoming Deadlines" to="/deadlines" footer="Open Deadlines Board" delay={0.38}>
        <span className="block space-y-2.5">
          {NEXT_DEADLINES.map((d) => (
            <span key={d.label} className="flex items-center gap-3">
              <DeadlineRing daysLeft={d.days} size={34} />
              <span>
                <span className="block text-[13px] leading-4 font-semibold text-ink">{d.label}</span>
                <span className="block text-[11px] leading-4 text-ink-3">{d.caption} · {d.days} days left</span>
              </span>
            </span>
          ))}
        </span>
      </BriefCard>

      {/* 6 — Billing */}
      <BriefCard label="Billing" to="/alerts" footer="View Billing Alert" delay={0.45} amber>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[32px] leading-10 font-medium text-ink tnum">₹8.4&nbsp;L</span>
          <span className="text-[13px] text-ink-2">outstanding</span>
        </span>
        <span className="mt-2 block text-[12px] leading-4 text-ink-3">11 invoices more than 90 days overdue</span>
      </BriefCard>
    </section>
  );
}
