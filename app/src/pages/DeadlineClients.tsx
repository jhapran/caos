// Client-list drill-down (`/deadlines/:id/clients?filter=…`) — the canonical
// "click 34 Blocked → filterable client list" destination. URL-driven filters,
// search, owner/risk filters, bulk actions, real CSV export.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  Check,
  ChevronRight,
  Download,
  PartyPopper,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import Avatar from '@/components/Avatar';
import Breadcrumb from '@/components/Breadcrumb';
import CountUp from '@/components/CountUp';
import DataTable from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import StatusPill from '@/components/StatusPill';
import {
  fetchDeadline,
  fetchDeadlineClients,
  ownerOf,
  useDemoStore,
} from '@/data';
import type { DeadlineClientRow, DeadlineGroup, Reminder } from '@/data';
import { demoNowIso, fmtDate, relTo, riskTextClass } from './deadlines/utils';
import { cn } from '@/lib/utils';

type FilterId = 'all' | 'ready' | 'blocked' | 'risk';

const FILTERS: { id: FilterId; label: string; caption: string }[] = [
  { id: 'all', label: 'All', caption: 'client entities on this deadline' },
  { id: 'ready', label: 'Ready', caption: 'on track for this deadline' },
  { id: 'blocked', label: 'Blocked', caption: 'blocked by missing information' },
  { id: 'risk', label: 'At Risk', caption: 'at risk of missing the statutory date' },
];

type RiskBand = 'all' | 'critical' | 'watch' | 'low';

function matchesFilter(row: DeadlineClientRow, f: FilterId): boolean {
  const t = row.task;
  if (f === 'blocked') return t.category === 'waiting';
  if (f === 'risk') return t.atRisk;
  if (f === 'ready') return t.category !== 'waiting' && !t.atRisk;
  return true;
}

function matchesRiskBand(row: DeadlineClientRow, band: RiskBand): boolean {
  const s = row.task.riskScore;
  if (band === 'critical') return s >= 70;
  if (band === 'watch') return s >= 40 && s < 70;
  if (band === 'low') return s < 40;
  return true;
}

function requestedAt(row: DeadlineClientRow): string | undefined {
  const h = row.task.history;
  return (h.find((e) => e.state === 'Information Requested') ?? h[0])?.at;
}

/** Real CSV download generated from the seeded rows — a delightful demo beat. */
function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function DeadlineClients() {
  const { id = '' } = useParams();
  // Remount on id change so per-group state (selection, nudges) resets cleanly.
  return <DeadlineClientsInner key={id} id={id} />;
}

function DeadlineClientsInner({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { sendReminder, notify, reminders: storeReminders } = useDemoStore();

  const filter: FilterId = (FILTERS.some((f) => f.id === params.get('filter'))
    ? params.get('filter')
    : 'all') as FilterId;

  const [group, setGroup] = useState<DeadlineGroup | null | undefined>(undefined);
  const [rows, setRows] = useState<DeadlineClientRow[]>([]);
  const [query, setQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [riskBand, setRiskBand] = useState<RiskBand>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nudged, setNudged] = useState<Set<string>>(new Set());
  const [localReminders, setLocalReminders] = useState<Record<string, Reminder[]>>({});

  useEffect(() => {
    let live = true;
    Promise.all([fetchDeadline(id), fetchDeadlineClients(id)]).then(([g, r]) => {
      if (!live) return;
      setGroup(g ?? null);
      setRows(r);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = { all: rows.length, ready: 0, blocked: 0, risk: 0 };
    for (const r of rows) {
      if (matchesFilter(r, 'blocked')) c.blocked += 1;
      else if (matchesFilter(r, 'risk')) c.risk += 1;
      else c.ready += 1;
    }
    return c;
  }, [rows]);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const o = ownerOf(r.task.ownerId);
      map.set(o.id, o.name);
    }
    return [...map.entries()].map(([oid, name]) => ({ id: oid, name }));
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesFilter(r, filter)) return false;
      if (!matchesRiskBand(r, riskBand)) return false;
      if (ownerFilter !== 'all' && r.task.ownerId !== ownerFilter) return false;
      if (q) {
        const hay = `${r.client.name} ${r.client.gstin ?? ''} ${r.client.pan ?? ''} ${r.client.city}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, riskBand, ownerFilter, query]);

  const allReminders = (r: DeadlineClientRow): Reminder[] =>
    [...r.task.reminders, ...(storeReminders[r.client.id] ?? []), ...(localReminders[r.client.id] ?? [])].sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
    );

  const setFilter = (f: FilterId) => {
    setParams(f === 'all' ? {} : { filter: f });
    setSelected(new Set());
  };

  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((r) => r.task.id)));
  };

  const toggleOne = (taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const nudge = (r: DeadlineClientRow) => {
    sendReminder(r.client.id); // store toast + app-wide "last reminder" update
    setNudged((prev) => new Set(prev).add(r.task.id));
  };

  const selectedRows = visible.filter((r) => selected.has(r.task.id));

  const bulkRemind = () => {
    // Page-local overlay (one toast instead of N) — columns still reflect the send.
    const now = demoNowIso();
    setLocalReminders((prev) => {
      const next = { ...prev };
      for (const r of selectedRows) {
        next[r.client.id] = [
          ...(next[r.client.id] ?? []),
          { sentAt: now, channel: 'Email', by: 'CA Pranav Sharma' },
        ];
      }
      return next;
    });
    notify(`Reminders sent to ${selectedRows.length} client${selectedRows.length === 1 ? '' : 's'}`);
    setSelected(new Set());
  };

  const bulkEscalate = () => {
    notify(`Escalated ${selectedRows.length} client${selectedRows.length === 1 ? '' : 's'} to Priya Nair (Manager)`, 'warning');
    setSelected(new Set());
  };

  const bulkExport = () => {
    if (!group) return;
    const target = selectedRows.length > 0 ? selectedRows : visible;
    const meta = FILTERS.find((f) => f.id === filter)!;
    downloadCsv(
      `${group.complianceId}-${group.period.replace(/\s+/g, '-').toLowerCase()}-${filter}-clients.csv`,
      ['Client', 'GSTIN', 'Owner', 'Status', 'Blocking items', 'Requested', 'Reminders', 'Last reminder', 'Risk score'],
      target.map((r) => {
        const rems = allReminders(r);
        const last = rems[rems.length - 1];
        return [
          r.client.name,
          r.client.gstin ?? '—',
          ownerOf(r.task.ownerId).name,
          r.task.atRisk ? 'At Risk' : r.task.state,
          r.task.missingDocs.join('; ') || '—',
          requestedAt(r) ? fmtDate(requestedAt(r)!) : '—',
          `${rems.length}x`,
          last ? fmtDate(last.sentAt) : '—',
          String(r.task.riskScore),
        ];
      }),
    );
    notify(`Exported ${target.length} ${meta.label.toLowerCase()} clients to CSV`, 'info');
  };

  const columns: Column<DeadlineClientRow>[] = [
    {
      key: 'select',
      header: '',
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.task.id)}
          onChange={() => toggleOne(r.task.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${r.client.name}`}
          className="h-4 w-4 accent-[#0E5F52]"
        />
      ),
      className: 'w-8',
    },
    {
      key: 'client',
      header: 'Client',
      sortValue: (r) => r.client.name,
      render: (r) => (
        <span>
          <span className="block font-semibold text-ink">{r.client.name}</span>
          <span className="block font-mono text-[11px] text-ink-3">
            {r.client.gstin ?? r.client.pan ?? r.client.entityType}
          </span>
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      sortValue: (r) => ownerOf(r.task.ownerId).name,
      render: (r) => {
        const o = ownerOf(r.task.ownerId);
        return (
          <span className="flex items-center gap-2">
            <Avatar name={o.name} size="xs" />
            <span className="text-ink-2">{o.name}</span>
          </span>
        );
      },
    },
    {
      key: 'blocking',
      header: 'Blocking items',
      render: (r) =>
        r.task.missingDocs.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {r.task.missingDocs.slice(0, 2).map((d) => (
              <span
                key={d}
                className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-warning-strong"
              >
                {d}
              </span>
            ))}
            {r.task.missingDocs.length > 2 && (
              <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-medium text-ink-2">
                +{r.task.missingDocs.length - 2}
              </span>
            )}
          </span>
        ),
    },
    {
      key: 'requested',
      header: 'Requested',
      numeric: true,
      sortValue: (r) => requestedAt(r) ?? '',
      render: (r) => {
        const at = requestedAt(r);
        return <span className="text-ink-2 tnum">{at ? fmtDate(at) : '—'}</span>;
      },
    },
    {
      key: 'reminders',
      header: 'Reminders',
      numeric: true,
      sortValue: (r) => allReminders(r).length,
      render: (r) => {
        const n = allReminders(r).length;
        return <span className={cn('font-mono text-[12px] tnum', n > 0 ? 'text-ink' : 'text-ink-3')}>{n}×</span>;
      },
    },
    {
      key: 'lastReminder',
      header: 'Last reminder',
      numeric: true,
      sortValue: (r) => {
        const rems = allReminders(r);
        return rems.length ? rems[rems.length - 1].sentAt : '';
      },
      render: (r) => {
        const rems = allReminders(r);
        return <span className="text-ink-2">{rems.length ? relTo(rems[rems.length - 1].sentAt) : '—'}</span>;
      },
    },
    {
      key: 'risk',
      header: 'Risk',
      numeric: true,
      sortValue: (r) => r.task.riskScore,
      render: (r) => (
        <span className={cn('font-mono text-[12px] font-medium tnum', riskTextClass(r.task.riskScore))}>
          {r.task.riskScore}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill status={r.task.atRisk ? 'At Risk' : r.task.state} size="sm" />,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <span className="flex items-center justify-end gap-1.5">
          {nudged.has(r.task.id) ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-success-soft px-2.5 py-1.5 text-[12px] font-medium text-success">
              <Check className="h-3.5 w-3.5" /> Sent
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                nudge(r);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
            >
              <Bell className="h-3.5 w-3.5" /> Nudge
            </button>
          )}
          <ChevronRight className="h-4 w-4 text-ink-3" />
        </span>
      ),
      className: 'text-right',
    },
  ];

  // ---- not-found / loading states ----
  if (group === null) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Unknown deadline"
        description="This deadline group doesn't exist in the seeded demo data."
        action={{ label: 'Back to Deadlines', onClick: () => navigate('/deadlines') }}
      />
    );
  }

  const activeMeta = FILTERS.find((f) => f.id === filter)!;

  return (
    <div>
      {/* Header — breadcrumb reconstructs the click path; clicked number echoed large */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
        <Breadcrumb
          items={[
            { label: 'Command Centre', href: '/command' },
            { label: 'Deadlines', href: '/deadlines' },
            ...(group
              ? [
                  {
                    label: `${group.complianceName} · ${group.period}`,
                    href: `/deadlines/${encodeURIComponent(group.id)}/clients`,
                  },
                ]
              : []),
            { label: activeMeta.label },
          ]}
        />
        <div className="mt-3 flex items-start gap-5">
          <div className="shrink-0 border-b-[3px] border-gold pb-1">
            <span className="text-stat-xl text-ink">
              <CountUp value={counts[filter]} duration={0.6} />
            </span>
          </div>
          <div>
            <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">
              {group ? `${group.complianceName} — ${activeMeta.label} clients` : 'Loading…'}
            </h1>
            <p className="mt-1 text-[13px] text-ink-3">
              {group && (
                <>
                  <span className="font-semibold text-ink-2">{counts[filter]} clients</span> · {activeMeta.caption} · due{' '}
                  {fmtDate(group.dueDate)}
                </>
              )}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Filter chips — counts on each, active pill slides via layoutId */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.06 }}
        className="mt-5 flex flex-wrap items-center gap-2"
      >
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={cn(
                'relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                active ? 'text-white' : 'bg-card text-ink-2 hover:bg-paper-deep',
              )}
            >
              {active && (
                <motion.span
                  layoutId="deadline-filter-pill"
                  className="absolute inset-0 rounded-full bg-brand"
                  transition={{ type: 'spring', duration: 0.45, bounce: 0.2 }}
                />
              )}
              <span className="relative z-10">
                {f.label}{' '}
                <span className={cn('font-mono text-[11px] tnum', active ? 'text-white/80' : 'text-ink-3')}>
                  {counts[f.id]}
                </span>
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Toolbar — search, owner filter, risk band, select all */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.12 }}
        className="mt-4 flex flex-wrap items-center gap-3"
      >
        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, GSTIN, city…"
            className="w-60 rounded-lg border border-line bg-card py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-3 focus:border-brand"
          />
        </div>
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] font-medium text-ink focus:border-brand"
          aria-label="Filter by owner"
        >
          <option value="all">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          value={riskBand}
          onChange={(e) => setRiskBand(e.target.value as RiskBand)}
          className="rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] font-medium text-ink focus:border-brand"
          aria-label="Filter by risk band"
        >
          <option value="all">All risk bands</option>
          <option value="critical">Critical · 70+</option>
          <option value="watch">Watch · 40–69</option>
          <option value="low">Low · &lt;40</option>
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2 select-none">
          <input
            type="checkbox"
            checked={visible.length > 0 && selected.size === visible.length}
            onChange={toggleAll}
            className="h-4 w-4 accent-[#0E5F52]"
          />
          Select all ({visible.length})
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={bulkExport}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut', delay: 0.18 }}
        className="mt-4"
      >
        {group === undefined ? (
          <div className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line/60 px-5 py-4 last:border-0">
                <div className="h-4 w-4 animate-pulse rounded bg-paper-deep" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-44 animate-pulse rounded bg-paper-deep" />
                  <div className="h-2.5 w-28 animate-pulse rounded bg-paper-deep" />
                </div>
                <div className="h-6 w-6 animate-pulse rounded-full bg-paper-deep" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={PartyPopper}
            title="No clients in this state — nice."
            description={
              filter === 'blocked'
                ? 'Nothing is blocked on this deadline right now.'
                : 'Try widening the filters or clearing the search.'
            }
            action={{ label: 'Show all clients', onClick: () => setFilter('all') }}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.task.id}
            onRowClick={(r) => navigate(`/compliance/${r.task.id}`)}
            pageSize={15}
            caption={`${group.complianceName} · ${group.period} — ${activeMeta.label.toLowerCase()} client list`}
          />
        )}
      </motion.div>

      {/* Bulk action bar — slides up from the table footer on selection */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            key="bulkbar"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
            className="sticky bottom-4 z-20 mt-4 flex items-center gap-3 rounded-xl border border-line bg-brand-deep px-4 py-3 text-paper shadow-lift"
          >
            <span className="text-[13px] font-semibold tnum">{selected.size} selected</span>
            <span className="h-4 w-px bg-paper/25" />
            <button
              type="button"
              onClick={bulkRemind}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand/85"
            >
              <Bell className="h-3.5 w-3.5" /> Send reminder
            </button>
            <button
              type="button"
              onClick={bulkEscalate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-paper/30 px-3 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-paper/10"
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Escalate to manager
            </button>
            <button
              type="button"
              onClick={bulkExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-paper/30 px-3 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-paper/10"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="rounded-md p-1.5 text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
