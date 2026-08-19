import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock3, FileX2, Hourglass, TriangleAlert, Users } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { useCountUp } from '@/components/CountUp';
import DataTable from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import StatCard from '@/components/StatCard';
import { DEPENDENCY_TOTALS, useDemoStore } from '@/data';
import type { DependencyClient } from '@/data';
import { cn } from '@/lib/utils';
import ClientDrawer from './dependency/ClientDrawer';
import Meter from './dependency/Meter';
import RightRail from './dependency/RightRail';
import {
  averageWait,
  baseReminderCount,
  DOC_MATRIX,
  DOC_TOTAL,
  entityCaption,
  fmtDay,
  matchesDocFilter,
  missingItems,
  ownerName,
} from './dependency/dependencyModel';

type KpiFilter = 'all' | 'repeat' | 'slow' | null;

const sectionMotion = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay: i * 0.06, ease: 'easeOut' as const },
});

/** Avg-wait card — mirrors StatCard but keeps the single decimal (e.g. "6.3 days"). */
function AvgWaitCard({ avg, onClick }: { avg: number; onClick: () => void }) {
  const v = useCountUp(Math.round(avg * 10));
  const hot = avg > 5;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-line bg-card p-5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-lift"
    >
      <div className="flex items-start justify-between">
        <span className="text-caption">Avg wait</span>
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg',
            hot ? 'bg-warning-soft text-warning-strong' : 'bg-brand-soft text-brand',
          )}
        >
          <Hourglass className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
      </div>
      <div className={cn('mt-2 text-stat-xl', hot ? 'text-warning-strong' : 'text-brand')}>
        {(v / 10).toFixed(1)}
        <span className="ml-1 font-sans text-[13px] font-medium text-ink-3">days</span>
      </div>
      <div className="mt-1 text-[12px] leading-4 text-ink-3">
        {hot ? 'Above the 5-day comfort line' : 'Within comfort line'}
      </div>
    </button>
  );
}

/** Client Dependency — top blockers, missing documents, reminder / escalation actions. */
export default function ClientDependency() {
  const { dependencyClients, sendReminder, reminders } = useDemoStore();
  const [selected, setSelected] = useState<DependencyClient | null>(null);
  const [docFilter, setDocFilter] = useState<string | null>(null);
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null);
  const [nudged, setNudged] = useState<Record<string, boolean>>({});

  const ranked = useMemo(
    () =>
      [...dependencyClients].sort(
        (a, b) => b.blockingTasks - a.blockingTasks || b.oldestWaitDays - a.oldestWaitDays,
      ),
    [dependencyClients],
  );

  const podium = ranked.slice(0, 3);
  const maxBlocked = ranked[0]?.blockingTasks ?? 1;

  const tableRows = useMemo(() => {
    let rows = ranked.slice(3);
    if (docFilter) rows = rows.filter((d) => matchesDocFilter(d, docFilter));
    if (kpiFilter === 'repeat') rows = rows.filter((d) => d.blockingTasks >= 2);
    if (kpiFilter === 'slow') rows = rows.filter((d) => d.oldestWaitDays >= 6);
    return rows;
  }, [ranked, docFilter, kpiFilter]);

  const avgWait = averageWait(dependencyClients);
  const reminderCount = (d: DependencyClient) =>
    baseReminderCount(d.clientId) + (reminders[d.clientId]?.length ?? 0);

  const nudge = (d: DependencyClient) => {
    sendReminder(d.clientId, 'WhatsApp');
    setNudged((m) => ({ ...m, [d.clientId]: true }));
  };

  const kpiClick = (f: Exclude<KpiFilter, null>) => {
    setKpiFilter((cur) => (cur === f ? null : f));
  };

  const columns: Column<DependencyClient>[] = [
    {
      key: 'rank',
      header: 'Rank',
      className: 'w-12',
      sortValue: (d) => ranked.indexOf(d),
      render: (d) => <span className="font-mono text-[12px] text-ink-3 tnum">{ranked.indexOf(d) + 1}</span>,
    },
    {
      key: 'client',
      header: 'Client',
      sortValue: (d) => d.clientName,
      render: (d) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={d.clientName} size="sm" />
          <div>
            <div className="text-[13px] font-semibold text-ink">{d.clientName}</div>
            <div className="text-[11px] text-ink-3">{entityCaption(d.clientId)}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'missing',
      header: 'Missing items',
      render: (d) => (
        <div className="flex flex-wrap items-center gap-1">
          {d.missingDocs.slice(0, 1).map((doc) => (
            <span
              key={doc}
              className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-strong"
            >
              {doc}
            </span>
          ))}
          {d.missingDocs.length > 1 && (
            <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-medium text-ink-3 tnum">
              +{d.missingDocs.length - 1}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'blocked',
      header: 'Tasks blocked',
      numeric: true,
      sortValue: (d) => d.blockingTasks,
      render: (d) => <span className="font-mono text-[13px] font-medium text-ink tnum">{d.blockingTasks}</span>,
    },
    {
      key: 'oldest',
      header: 'Oldest request',
      numeric: true,
      sortValue: (d) => d.oldestWaitDays,
      render: (d) => (
        <span
          className={cn(
            'font-mono text-[13px] tnum',
            d.oldestWaitDays >= 10 ? 'font-semibold text-critical' : d.oldestWaitDays >= 6 ? 'text-warning-strong' : 'text-ink-2',
          )}
        >
          {d.oldestWaitDays}d
        </span>
      ),
    },
    {
      key: 'reminders',
      header: 'Reminders',
      numeric: true,
      sortValue: (d) => reminderCount(d),
      render: (d) => <span className="font-mono text-[13px] text-ink-2 tnum">{reminderCount(d)}×</span>,
    },
    {
      key: 'last',
      header: 'Last reminder',
      sortValue: (d) => d.lastReminderAt ?? '',
      render: (d) => <span className="text-[12px] text-ink-2">{fmtDay(d.lastReminderAt)}</span>,
    },
    {
      key: 'owner',
      header: 'Owner',
      sortValue: (d) => ownerName(d.ownerId),
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <Avatar name={ownerName(d.ownerId)} size="xs" />
          <span className="text-[12px] text-ink-2">{ownerName(d.ownerId)}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (d) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => nudge(d)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
              nudged[d.clientId]
                ? 'bg-success-soft text-success'
                : 'bg-brand text-white hover:bg-brand-deep',
            )}
          >
            {nudged[d.clientId] ? 'Nudged' : 'Nudge'}
          </button>
          <button
            type="button"
            onClick={() => setSelected(d)}
            className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
          >
            Open
          </button>
        </div>
      ),
    },
  ];

  const activeDocLabel = DOC_MATRIX.find((d) => d.id === docFilter)?.label;

  return (
    <div>
      {/* Section 1 — Header + KPI band */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">Client Dependency</h1>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-warning/40 bg-warning-soft px-4 py-2.5">
          <TriangleAlert className="h-4 w-4 shrink-0 text-warning-strong" />
          <p className="text-[13px] font-medium text-warning-strong">
            <span className="tnum">{DEPENDENCY_TOTALS.clients}</span> clients currently blocking{' '}
            <span className="tnum">{DEPENDENCY_TOTALS.blockedTasks}</span> compliance tasks.
          </p>
        </div>
      </motion.div>

      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <motion.div {...sectionMotion(1)}>
          <StatCard
            label="Clients blocking"
            value={DEPENDENCY_TOTALS.clients}
            delta="Across all compliance types"
            icon={Users}
            tone="warning"
            onClick={() => kpiClick('all')}
          />
        </motion.div>
        <motion.div {...sectionMotion(2)}>
          <StatCard
            label="Tasks blocked"
            value={DEPENDENCY_TOTALS.blockedTasks}
            delta="Awaiting client information"
            icon={Clock3}
            tone="warning"
            onClick={() => kpiClick('repeat')}
          />
        </motion.div>
        <motion.div {...sectionMotion(3)}>
          <StatCard
            label="Documents outstanding"
            value={DOC_TOTAL}
            delta="Bank statements lead — 38"
            icon={FileX2}
            tone="ink"
            onClick={() => setDocFilter(null)}
          />
        </motion.div>
        <motion.div {...sectionMotion(4)}>
          <AvgWaitCard avg={avgWait} onClick={() => kpiClick('slow')} />
        </motion.div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Main column */}
        <div className="space-y-8 xl:col-span-8">
          {/* Section 2 — Top blockers */}
          <motion.section {...sectionMotion(2)}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[17px] leading-6 font-semibold text-ink">Top blockers</h2>
              <span className="text-caption">Ranked by blocked tasks</span>
            </div>

            {/* Podium — top 3 */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              {podium.map((d, i) => (
                <motion.div
                  key={d.clientId}
                  initial={{ opacity: 0, scale: 0.95, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', duration: 0.5, bounce: 0.25, delay: 0.15 + i * 0.1 }}
                  className="rounded-xl border border-line bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div className="flex items-start justify-between">
                    <Avatar name={d.clientName} size="lg" />
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold tnum',
                        i === 0 ? 'bg-gold-soft text-gold' : 'bg-warning-soft text-warning-strong',
                      )}
                    >
                      #{i + 1}
                    </span>
                  </div>
                  <div className="mt-3 text-[14px] font-semibold text-ink">{d.clientName}</div>
                  <div className="mt-0.5 font-mono text-[12px] text-ink-2 tnum">
                    {missingItems(d)} missing items · {d.blockingTasks} tasks blocked
                  </div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    oldest request <span className="tnum">{d.oldestWaitDays} days</span> ·{' '}
                    <span className="tnum">{reminderCount(d)}</span> reminders sent
                  </div>
                  <Meter value={d.blockingTasks} max={maxBlocked} tone="amber" className="mt-3" />
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => nudge(d)}
                      className="flex-1 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-deep"
                    >
                      Nudge all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(d)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                    >
                      Open
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Active filters */}
            {(docFilter || kpiFilter === 'repeat' || kpiFilter === 'slow') && (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-2">
                <span>Filtered:</span>
                {activeDocLabel && (
                  <button
                    type="button"
                    onClick={() => setDocFilter(null)}
                    className="rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand hover:bg-brand hover:text-white"
                  >
                    {activeDocLabel} ×
                  </button>
                )}
                {kpiFilter === 'repeat' && (
                  <button
                    type="button"
                    onClick={() => setKpiFilter(null)}
                    className="rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand hover:bg-brand hover:text-white"
                  >
                    2+ tasks blocked ×
                  </button>
                )}
                {kpiFilter === 'slow' && (
                  <button
                    type="button"
                    onClick={() => setKpiFilter(null)}
                    className="rounded-full bg-brand-soft px-2.5 py-1 font-medium text-brand hover:bg-brand hover:text-white"
                  >
                    Waiting 6+ days ×
                  </button>
                )}
              </div>
            )}

            {/* Full blocker table */}
            <div className="mt-4">
              <DataTable
                columns={columns}
                rows={tableRows}
                rowKey={(d) => d.clientId}
                onRowClick={(d) => setSelected(d)}
                pageSize={15}
                emptyMessage="No clients match this filter right now."
              />
            </div>
          </motion.section>

          {/* Section 3 — Missing documents matrix */}
          <motion.section {...sectionMotion(4)}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[17px] leading-6 font-semibold text-ink">What's missing, by type</h2>
              <span className="text-caption">
                <span className="tnum">{DOC_TOTAL}</span> outstanding documents
              </span>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card shadow-card">
              {DOC_MATRIX.map((row, i) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setDocFilter((cur) => (cur === row.id ? null : row.id))}
                  className={cn(
                    'grid w-full grid-cols-[minmax(140px,1.2fr)_64px_minmax(120px,1fr)_minmax(140px,1fr)] items-center gap-4 border-b border-line/60 px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-brand-soft/40',
                    i % 2 === 1 && 'bg-paper-deep/50',
                    docFilter === row.id && 'bg-brand-soft/60',
                  )}
                >
                  <span className="text-[13px] font-medium text-ink">{row.label}</span>
                  <span className="text-right font-mono text-[13px] font-semibold text-ink tnum">{row.count}</span>
                  <Meter value={row.count} max={38} tone="amber" />
                  <span className="text-right text-[11px] text-ink-3">
                    slowest: <span className="font-medium text-ink-2">{row.mostDelayed}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-ink-3">Click a row to filter the blocker table by document type.</p>
          </motion.section>
        </div>

        {/* Section 4 — Right rail */}
        <aside className="xl:col-span-4">
          <RightRail />
        </aside>
      </div>

      <ClientDrawer client={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
