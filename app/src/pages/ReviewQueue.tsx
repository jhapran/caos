import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import CountUp from '@/components/CountUp';
import EmptyState from '@/components/EmptyState';
import { TEAM, ownerOf, useDemoStore } from '@/data';
import type { ReviewType } from '@/data';
import { cn } from '@/lib/utils';
import Inspector from './review/Inspector';
import QueueRow, { waitingDays } from './review/QueueRow';
import { REVIEW_TYPE_META, TYPE_ORDER, slugToType } from './review/meta';

type Filter = 'all' | ReviewType;

/**
 * Review Queue (`/review`) — inbox-style triage of work awaiting partner review.
 * Approve / Return mutate the demo store so the sidebar badge and dashboard
 * counts update app-wide; `?type=` deep-links a type filter.
 */
export default function ReviewQueue() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { reviewItems, reviewPendingCount, approveReviewItem, returnReviewItem, notify } = useDemoStore();

  const filter: Filter = slugToType(searchParams.get('type')) ?? 'all';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnRequestKey, setReturnRequestKey] = useState(0);

  // Pending items, oldest first.
  const pending = useMemo(
    () =>
      reviewItems
        .filter((r) => r.status === 'pending')
        .slice()
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [reviewItems],
  );
  const filtered = useMemo(
    () => (filter === 'all' ? pending : pending.filter((r) => r.type === filter)),
    [pending, filter],
  );
  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  // Keep selection valid as the list changes (approvals, filter switches).
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!filtered.some((r) => r.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const setFilter = (f: Filter) => {
    if (f === 'all') setSearchParams({}, { replace: true });
    else setSearchParams({ type: REVIEW_TYPE_META[f].slug }, { replace: true });
  };

  const oldestWaiting = pending.length > 0 ? waitingDays(pending[0]) : 0;

  const approve = (id: string, comment?: string) => {
    const item = reviewItems.find((r) => r.id === id);
    approveReviewItem(id, comment);
    notify(`Approved — ${item?.title ?? 'item'} moved to Ready to File`, 'success');
  };

  const returnItem = (id: string, reason: string) => {
    const item = reviewItems.find((r) => r.id === id);
    returnReviewItem(id, reason);
    notify(`Returned to ${item ? ownerOf(item.submittedBy).name : 'preparer'} for changes`, 'warning');
  };

  const reassign = (id: string) => {
    const item = reviewItems.find((r) => r.id === id);
    const next = TEAM[(TEAM.findIndex((t) => t.id === item?.submittedBy) + 2) % TEAM.length];
    notify(`Reassigned to ${next.name} (demo)`, 'info');
  };

  // Keyboard triage: ↑/↓ move selection, A approve, R return.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = filtered.findIndex((r) => r.id === selectedId);
      if (e.key === 'ArrowDown' && filtered.length > 0) {
        e.preventDefault();
        setSelectedId(filtered[Math.min(filtered.length - 1, idx + 1)].id);
      } else if (e.key === 'ArrowUp' && filtered.length > 0) {
        e.preventDefault();
        setSelectedId(filtered[Math.max(0, idx <= 0 ? 0 : idx - 1)].id);
      } else if ((e.key === 'a' || e.key === 'A') && selectedId) {
        approve(selectedId);
      } else if ((e.key === 'r' || e.key === 'R') && selectedId) {
        setReturnRequestKey((k) => k + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, selectedId, reviewItems]);

  const countFor = (t: ReviewType) => pending.filter((r) => r.type === t).length;

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: pending.length },
    ...TYPE_ORDER.map((t) => ({ key: t as Filter, label: REVIEW_TYPE_META[t].plural, count: countFor(t) })),
  ];

  return (
    <div>
      {/* Header + summary */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
        <Breadcrumb items={[{ label: 'Command Centre', href: '/command' }, { label: 'Review Queue' }]} />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">Review Queue</h1>
            <p className="mt-1 text-[13px] text-ink-2">
              <span className="font-semibold text-ink tnum">{reviewPendingCount} items awaiting review</span>
              {pending.length > 0 && <span className="text-ink-3"> · oldest waiting {oldestWaiting} days</span>}
            </p>
          </div>
          {/* SLA legend */}
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> &lt; 2 days</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" /> 2–3 days</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-critical" /> &gt; 3 days waiting</span>
          </div>
        </div>

        {/* KPI chips — clickable filters with count-ups */}
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip, i) => (
            <motion.button
              key={chip.key}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              onClick={() => setFilter(chip.key)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                filter === chip.key
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-card text-ink-2 hover:border-brand/40 hover:text-brand',
              )}
            >
              {chip.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold tnum',
                  filter === chip.key ? 'bg-white/20 text-white' : 'bg-paper-deep text-ink-2',
                )}
              >
                <CountUp value={chip.count} duration={0.5} />
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Queue layout: list (7) + inspector (5) */}
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <div className="space-y-2.5 lg:col-span-7">
          {filtered.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={filter === 'all' ? 'Review queue is clear — nice work.' : `Queue clear for ${REVIEW_TYPE_META[filter].plural} — nice work.`}
              description={filter === 'all' ? 'Everything submitted has been reviewed.' : 'Try another type, or view the full queue.'}
              action={filter !== 'all' ? { label: 'View all items', onClick: () => setFilter('all') } : undefined}
            />
          ) : (
            <AnimatePresence>
              {filtered.map((item, i) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  index={i}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-[84px]">
            <Inspector
              item={selected}
              onApprove={approve}
              onReturn={returnItem}
              onReassign={reassign}
              returnRequestKey={returnRequestKey}
            />
          </div>
        </div>
      </div>

      {/* Footer stats strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: 0.4 }}
        className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 rounded-xl border border-line bg-card px-6 py-4 shadow-card"
      >
        <span className="text-[12.5px] text-ink-3">
          Reviewed this week: <span className="font-mono font-semibold text-ink tnum"><CountUp value={34} /></span>
        </span>
        <span className="text-[12.5px] text-ink-3">
          Avg turnaround: <span className="font-mono font-semibold text-ink tnum">1.6 days</span>
        </span>
        <span className="text-[12.5px] text-ink-3">
          Returned rate: <span className="font-mono font-semibold text-ink tnum"><CountUp value={9} />%</span>
        </span>
      </motion.div>
    </div>
  );
}
