// Deadlines board (`/deadlines`) — full statutory calendar across all compliance
// types. Every numeric cell is a DrillLink into the filterable client list.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, LayoutList, Search } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import DeadlineRing from '@/components/DeadlineRing';
import EmptyState from '@/components/EmptyState';
import { SegmentedControl } from '@/components/Tabs';
import { DrillLink } from '@/components/DataTable';
import { fetchDeadlines, getCompliance, getDeadlineClients } from '@/data';
import type { DeadlineGroup } from '@/data';
import TimelineView from './deadlines/TimelineView';
import { CATEGORY_ICON, dueLabel, fmtDate, groupReady } from './deadlines/utils';
import { CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';

type SortKey = 'due-asc' | 'due-desc' | 'clients' | 'blocked' | 'risk';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'due-asc', label: 'Due date ↑' },
  { id: 'due-desc', label: 'Due date ↓' },
  { id: 'clients', label: 'Most clients' },
  { id: 'blocked', label: 'Most blocked' },
  { id: 'risk', label: 'Most at risk' },
];

const CATEGORIES = ['All', 'GST', 'TDS', 'Income Tax', 'Audit', 'MCA', 'Payroll'];

/** Thin coverage meter (Ready / Clients %) — fills over 0.6s. */
function CoverageBar({ pct }: { pct: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-paper-deep">
        <motion.span
          className={cn('block h-full rounded-full', pct >= 80 ? 'bg-success' : pct >= 55 ? 'bg-brand' : 'bg-warning')}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </span>
      <span className="font-mono text-[11px] text-ink-3 tnum">{Math.round(pct)}%</span>
    </span>
  );
}

function BoardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line/60 px-5 py-4 last:border-0">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-paper-deep" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-paper-deep" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-paper-deep" />
          </div>
          <div className="h-10 w-10 animate-pulse rounded-full bg-paper-deep" />
        </div>
      ))}
    </div>
  );
}

export default function Deadlines() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<DeadlineGroup[] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<SortKey>('due-asc');
  const [view, setView] = useState<'table' | 'timeline'>('table');

  useEffect(() => {
    let live = true;
    fetchDeadlines().then((all) => {
      // Board shows the actionable statutory calendar: due today or later.
      if (live) setGroups(all.filter((g) => g.daysLeft >= 0));
    });
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    let out = groups.filter((g) => {
      const master = getCompliance(g.complianceId);
      if (category !== 'All' && master.category !== category) return false;
      if (!q) return true;
      const inName =
        g.complianceName.toLowerCase().includes(q) ||
        master.shortName.toLowerCase().includes(q) ||
        g.period.toLowerCase().includes(q);
      if (inName) return true;
      // "Search compliance or client…" — a client name match keeps the group visible.
      return getDeadlineClients(g.id).some((r) => r.client.name.toLowerCase().includes(q));
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case 'due-desc': return b.dueDate.localeCompare(a.dueDate);
        case 'clients': return b.totalClients - a.totalClients;
        case 'blocked': return b.waiting - a.waiting;
        case 'risk': return b.atRisk - a.atRisk;
        default: return a.dueDate.localeCompare(b.dueDate);
      }
    });
    return out;
  }, [groups, query, category, sort]);

  const rangeCaption = useMemo(() => {
    if (!filtered.length) return 'Statutory calendar';
    const first = new Date(filtered[0].dueDate);
    const last = new Date(filtered[filtered.length - 1].dueDate);
    return `${formatMonth(first)}–${formatMonth(last)} · statutory calendar`;
  }, [filtered]);

  const drill = (g: DeadlineGroup, filter: string) =>
    navigate(`/deadlines/${encodeURIComponent(g.id)}/clients?filter=${filter}`);
  const openGroup = (g: DeadlineGroup) => drill(g, 'all');

  return (
    <div>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
        <Breadcrumb items={[{ label: 'Command Centre', href: '/command' }, { label: 'Deadlines' }]} />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">Upcoming Deadlines</h1>
            <p className="mt-1 text-[13px] text-ink-3">{rangeCaption}</p>
          </div>
        </div>
      </motion.div>

      {/* Control bar — staggered fade-in */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.06 }}
        className="mt-5 flex flex-wrap items-center gap-3"
      >
        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search compliance or client…"
            className="w-64 rounded-lg border border-line bg-card py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-3 focus:border-brand"
          />
        </div>
        <SegmentedControl
          items={CATEGORIES.map((c) => ({ id: c, label: c }))}
          active={category}
          onChange={setCategory}
        />
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-ink-3">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] font-medium text-ink focus:border-brand"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <SegmentedControl
          items={[
            { id: 'table', label: 'Table' },
            { id: 'timeline', label: 'Timeline' },
          ]}
          active={view}
          onChange={(v) => setView(v as 'table' | 'timeline')}
        />
      </motion.div>

      {/* Body */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.12 }}
        className="mt-5"
      >
        {!groups ? (
          <BoardSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No deadlines match"
            description="Try a different category, search term, or clear the filters."
            action={{ label: 'Clear filters', onClick: () => { setQuery(''); setCategory('All'); } }}
          />
        ) : view === 'timeline' ? (
          <TimelineView groups={filtered} onOpen={openGroup} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px] leading-5">
                <thead>
                  <tr className="bg-paper-deep/70">
                    <th className="border-b border-line px-4 py-2.5 text-left text-caption">Compliance</th>
                    <th className="border-b border-line px-4 py-2.5 text-left text-caption">Statutory due</th>
                    <th className="border-b border-line px-4 py-2.5 text-right text-caption">Clients</th>
                    <th className="border-b border-line px-4 py-2.5 text-right text-caption">Ready</th>
                    <th className="border-b border-line px-4 py-2.5 text-right text-caption">Blocked</th>
                    <th className="border-b border-line px-4 py-2.5 text-right text-caption">At Risk</th>
                    <th className="border-b border-line px-4 py-2.5 text-left text-caption">Coverage</th>
                    <th className="border-b border-line px-2 py-2.5" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g, i) => {
                    const master = getCompliance(g.complianceId);
                    const Icon = CATEGORY_ICON[master.category] ?? LayoutList;
                    const ready = groupReady(g);
                    const coverage = g.totalClients ? (ready / g.totalClients) * 100 : 0;
                    return (
                      <motion.tr
                        key={g.id}
                        layout="position"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut', delay: Math.min(i * 0.04, 0.4) }}
                        onClick={() => openGroup(g)}
                        className={cn(
                          'cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-brand-soft/40',
                          i % 2 === 1 && 'bg-paper-deep/50',
                        )}
                      >
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                            </span>
                            <span>
                              <span className="block font-semibold text-ink">{master.shortName}</span>
                              <span className="block text-[12px] text-ink-3">
                                {g.period} · {master.frequency}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <DeadlineRing daysLeft={g.daysLeft} size={40} />
                            <span>
                              <span className="block font-medium text-ink tnum">{fmtDate(g.dueDate)}</span>
                              <span className={cn('block text-[12px]', g.daysLeft <= 7 ? 'text-critical' : 'text-ink-3')}>
                                {dueLabel(g.daysLeft)}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DrillLink onClick={() => drill(g, 'all')}>{g.totalClients}</DrillLink>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DrillLink onClick={() => drill(g, 'ready')}>
                            <span className="text-success">{ready}</span>
                          </DrillLink>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DrillLink onClick={() => drill(g, 'blocked')}>
                            <span className={g.waiting > 0 ? 'text-warning-strong' : 'text-ink-3'}>{g.waiting}</span>
                          </DrillLink>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DrillLink onClick={() => drill(g, 'risk')}>
                            <span className={g.atRisk > 0 ? 'text-critical' : 'text-ink-3'}>{g.atRisk}</span>
                          </DrillLink>
                        </td>
                        <td className="px-4 py-3">
                          <CoverageBar pct={coverage} />
                        </td>
                        <td className="px-2 py-3">
                          <ChevronRight className="h-4 w-4 text-ink-3" />
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-5 py-2.5 text-[12px] text-ink-3 tnum">
              {filtered.length} upcoming deadline{filtered.length === 1 ? '' : 's'} ·{' '}
              {filtered.reduce((s, g) => s + g.totalClients, 0).toLocaleString('en-IN')} client obligations
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
