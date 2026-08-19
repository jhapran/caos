import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ArrowRight, Building2, Coins, IndianRupee, Percent, Receipt, Scale } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import DataTable, { DrillLink } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import DeadlineRing from '@/components/DeadlineRing';
import { getCompliance, getDeadlineGroups } from '@/data';
import type { ComplianceId, ComplianceType, DeadlineGroup } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const CATEGORY_ICONS: Record<ComplianceType['category'], LucideIcon> = {
  GST: Receipt,
  TDS: Percent,
  'Income Tax': IndianRupee,
  Audit: Scale,
  MCA: Building2,
  Payroll: Coins,
};

/** The five showcase compliance lines for Section B (design: command-centre.md §B). */
const SHOWCASE: ComplianceId[] = ['gstr1', 'advance-tax', 'gstr3b', 'mca-aoc4', 'tds24q'];

interface DeadlineRow {
  group: DeadlineGroup;
  ready: number;
  blocked: number;
}

/**
 * Section B — Upcoming Deadlines. Rows derive live from getDeadlineGroups() so
 * every numeric cell reconciles with its drill-down client list.
 */
export default function DeadlinesCard({ delay = 0 }: { delay?: number }) {
  const navigate = useNavigate();

  const rows: DeadlineRow[] = useMemo(() => {
    const upcoming = getDeadlineGroups().filter((g) => g.daysLeft >= 0);
    return SHOWCASE.map((id) => upcoming.find((g) => g.complianceId === id))
      .filter((g): g is DeadlineGroup => Boolean(g))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((group) => ({
        group,
        ready: group.totalClients - group.waiting - group.notStarted,
        blocked: group.waiting,
      }));
  }, []);

  const drill = (g: DeadlineGroup, filter: string) =>
    `/deadlines/${g.complianceId}/clients?filter=${filter}&period=${encodeURIComponent(g.period)}`;

  const columns: Column<DeadlineRow>[] = [
    {
      key: 'compliance',
      header: 'Compliance',
      sortValue: (r) => r.group.complianceName,
      render: (r) => {
        const master = getCompliance(r.group.complianceId);
        const Icon = CATEGORY_ICONS[master.category];
        return (
          <span className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] leading-5 font-semibold text-ink">{master.shortName}</span>
              <span className="block text-[11px] leading-4 text-ink-3">{r.group.period}</span>
            </span>
          </span>
        );
      },
    },
    {
      key: 'due',
      header: 'Due Date',
      sortValue: (r) => r.group.daysLeft,
      render: (r) => (
        <span className="flex items-center gap-2.5">
          <DeadlineRing daysLeft={r.group.daysLeft} size={34} />
          <span>
            <span className="block font-mono text-[12.5px] leading-4 text-ink tnum">
              {format(parseISO(r.group.dueDate), 'd MMM')}
            </span>
            <span className={cn('block text-[11px] leading-4', r.group.daysLeft <= 5 ? 'text-critical' : 'text-ink-3')}>
              {r.group.daysLeft === 0 ? 'due today' : `in ${r.group.daysLeft}d`}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'clients',
      header: 'Clients',
      numeric: true,
      sortValue: (r) => r.group.totalClients,
      render: (r) => <DrillLink onClick={() => navigate(drill(r.group, 'all'))}>{r.group.totalClients}</DrillLink>,
    },
    {
      key: 'ready',
      header: 'Ready',
      numeric: true,
      sortValue: (r) => r.ready,
      render: (r) => (
        <DrillLink onClick={() => navigate(drill(r.group, 'ready'))}>
          <span className="text-success">{r.ready}</span>
        </DrillLink>
      ),
    },
    {
      key: 'blocked',
      header: 'Blocked',
      numeric: true,
      sortValue: (r) => r.blocked,
      render: (r) => (
        <DrillLink onClick={() => navigate(drill(r.group, 'blocked'))}>
          <span className="text-warning-strong">{r.blocked}</span>
        </DrillLink>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      numeric: true,
      sortValue: (r) => r.group.atRisk,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="relative h-1 w-7 overflow-hidden rounded-full bg-critical-soft" aria-hidden>
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-critical"
              style={{ width: `${Math.min(100, (r.group.atRisk / r.group.totalClients) * 100)}%` }}
            />
          </span>
          <DrillLink onClick={() => navigate(drill(r.group, 'risk'))}>
            <span className="text-critical">{r.group.atRisk}</span>
          </DrillLink>
        </span>
      ),
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Upcoming Deadlines"
      className="overflow-hidden rounded-xl border border-line bg-card shadow-card"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">Upcoming Deadlines</h2>
        <Link
          to="/deadlines"
          className="gold-underline-sweep flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-deep"
        >
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.group.id}
        onRowClick={(r) => navigate(drill(r.group, 'all'))}
        pageSize={8}
        className="rounded-none border-0 shadow-none"
      />

      <Link
        to="/deadlines"
        className="flex items-center justify-center gap-1.5 border-t border-line bg-paper/60 px-5 py-2.5 text-[12.5px] font-medium text-brand transition-colors hover:bg-brand-soft/50 hover:text-brand-deep"
      >
        View full deadlines board <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </motion.section>
  );
}
