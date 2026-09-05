/**
 * IMP-041 PASS C — Review Queue (`/review`), live on the @/data boundary.
 *
 * Data: reviewService.listReviewItems through useReviewQueue (RLS-filtered in
 * Supabase mode; the single fixture persona in demo mode) with the API-RT-01
 * invalidation subscription. Names resolve through clientHierarchyService /
 * client360Service — never through fixture modules.
 *
 * Decisions go through reviewService.decideReviewItem only (approve / return;
 * a non-empty rationale is mandatory for every decision — API-R0-RVW).
 * Nothing is optimistic (API-MUT-02): the queue re-reads after the RPC
 * confirms. Submission goes through reviewService.submitReviewItem via the
 * dialog. Decision controls are role-truthful presentation (RLS-RVW-01) —
 * the database remains the authorization authority.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Plus } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import CountUp from '@/components/CountUp';
import EmptyState from '@/components/EmptyState';
import { useShellIdentity } from '@/hooks/useShellIdentity';
import { useReviewQueue } from '@/hooks/useReviewQueue';
import {
  ApiError,
  client360Service,
  clientHierarchyService,
  getDataSource,
  reviewService,
  useDemoStore,
} from '@/data';
import type { ClientRecord, ReviewItemType, StaffRef } from '@/data';
import { cn } from '@/lib/utils';
import Inspector from './review/Inspector';
import QueueRow, { waitingDays } from './review/QueueRow';
import SubmitDialog from './review/SubmitDialog';
import { REVIEW_TYPE_META, TYPE_ORDER, slugToType } from './review/meta';

type Filter = 'all' | ReviewItemType;

const DECIDE_ROLES = new Set(['super_admin', 'partner', 'manager']); // RLS-RVW-01
const SUBMIT_ROLES = new Set(['super_admin', 'partner', 'manager', 'senior', 'article_executive']);
// Senior/article cannot enumerate clients (clients SELECT RLS excludes them)
// — their submission subject is an already-authorized ASSIGNED TASK instead
// (RLS-TSK-01 scope via taskService); the server derives the client.
const ASSIGNED_WORK_SUBJECT_ROLES = new Set(['senior', 'article_executive']);

export default function ReviewQueue() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useDemoStore();
  const demo = getDataSource() !== 'supabase';
  const shell = useShellIdentity();
  // Fixture mode = the single partner persona; Supabase mode = the live role.
  const role = demo ? 'partner' : (shell?.role ?? null);
  const canDecide = role !== null && DECIDE_ROLES.has(role);
  const canSubmit = role !== null && SUBMIT_ROLES.has(role);
  const subjectMode = role !== null && ASSIGNED_WORK_SUBJECT_ROLES.has(role) ? 'task' : 'client';

  const { items, loading, error, refetch } = useReviewQueue();

  const filter: Filter = slugToType(searchParams.get('type')) ?? 'all';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnRequestKey, setReturnRequestKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [staff, setStaff] = useState<StaffRef[]>([]);

  // Display-name directories (clients + staff), resolved through @/data.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([clientHierarchyService.listClients(), client360Service.listActiveStaff()])
      .then(([clientRows, staffRows]) => {
        if (cancelled) return;
        setClients(clientRows);
        setStaff(staffRows);
      })
      .catch(() => {
        // Names are presentation only; rows render with a dash fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const staffNameById = useMemo(() => new Map(staff.map((s) => [s.membershipId, s.fullName])), [staff]);
  const clientOwnerById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.ownerPartnerMembershipId])),
    [clients],
  );
  const clientName = (id: string) => clientNameById.get(id) ?? '—';
  const memberName = (id: string) => staffNameById.get(id) ?? '—';

  // Pending items, oldest first.
  const pending = useMemo(
    () =>
      (items ?? [])
        .filter((r) => r.status === 'pending')
        .slice()
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    [items],
  );
  const filtered = useMemo(
    () => (filter === 'all' ? pending : pending.filter((r) => r.type === filter)),
    [pending, filter],
  );
  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  // Keep selection valid as the list changes (approvals, filter switches).
  // Self-stabilizing adjust-during-render: after the correction re-render,
  // the guard conditions are false and no further setState occurs.
  if (filtered.length === 0) {
    if (selectedId !== null) setSelectedId(null);
  } else if (!filtered.some((r) => r.id === selectedId)) {
    setSelectedId(filtered[0].id);
  }

  const setFilter = (f: Filter) => {
    if (f === 'all') setSearchParams({}, { replace: true });
    else setSearchParams({ type: REVIEW_TYPE_META[f].slug }, { replace: true });
  };

  const oldestWaiting = pending.length > 0 ? waitingDays(pending[0]) : 0;

  // Decision commands — never optimistic (API-MUT-02): in-flight disable,
  // then a fresh RLS-controlled read after the RPC confirms.
  const decide = async (id: string, decision: 'approved' | 'returned', rationale: string) => {
    setBusyId(id);
    try {
      const result = await reviewService.decideReviewItem(id, { decision, rationale });
      if (result.status === 'already_applied') {
        notify('That decision was already applied', 'info');
      } else if (decision === 'approved') {
        notify(`Approved — ${result.item.title} moved to Ready to File`, 'success');
      } else {
        notify(`Returned to ${memberName(result.item.submittedByMembershipId)} for changes`, 'warning');
      }
      refetch();
    } catch (err) {
      // API-ERR-02 at the presentation layer: a hidden/nonexistent item gets
      // the same generic surface; other failures show the provider message.
      const message =
        err instanceof ApiError && err.kind === 'not_found'
          ? 'That review item is no longer available'
          : err instanceof ApiError
            ? err.message
            : 'The decision could not be recorded';
      notify(message, 'critical');
      refetch();
    } finally {
      setBusyId(null);
    }
  };

  const approve = (id: string, rationale: string) => void decide(id, 'approved', rationale);
  const returnItem = (id: string, rationale: string) => void decide(id, 'returned', rationale);

  // Demo-only affordance: presenter-only reassignment hint.
  const reassign = (id: string) => {
    const item = pending.find((r) => r.id === id);
    notify(`Reassign is a demo-only hint — ${item?.title ?? 'item'} unchanged`, 'info');
  };

  // Keyboard triage: ↑/↓ move selection, R opens the return rationale form.
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
      } else if ((e.key === 'r' || e.key === 'R') && selectedId && canDecide) {
        setReturnRequestKey((k) => k + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedId, canDecide]);

  const countFor = (t: ReviewItemType) => pending.filter((r) => r.type === t).length;

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
              <span className="font-semibold text-ink tnum">{pending.length} items awaiting review</span>
              {pending.length > 0 && <span className="text-ink-3"> · oldest waiting {oldestWaiting} days</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* SLA legend */}
            <div className="flex items-center gap-3 text-[11px] text-ink-3">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> &lt; 2 days</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" /> 2–3 days</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-critical" /> &gt; 3 days waiting</span>
            </div>
            {canSubmit && (
              <button
                type="button"
                onClick={() => setSubmitOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-deep"
              >
                <Plus className="h-4 w-4" />
                Submit for review
              </button>
            )}
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
          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-20 text-center">
              <p className="text-[14px] font-medium text-ink">Loading the review queue…</p>
              <p className="mt-1 text-[13px] text-ink-3">Reading your authorized items.</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-20 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-critical-soft">
                <AlertCircle className="h-5 w-5 text-critical" strokeWidth={1.8} />
              </span>
              <p className="mt-4 text-[14px] font-medium text-ink">Could not load the review queue</p>
              <p className="mt-1 text-[13px] text-ink-3">{error.message}</p>
              <button
                type="button"
                onClick={refetch}
                className="mt-4 rounded-lg border border-line bg-card px-4 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
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
                  clientName={clientName(item.clientId)}
                  submitterName={memberName(item.submittedByMembershipId)}
                  demo={demo}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-[84px]">
            <Inspector
              item={selected}
              clientName={selected ? clientName(selected.clientId) : ''}
              submitterName={selected ? memberName(selected.submittedByMembershipId) : ''}
              ownerName={selected ? memberName(clientOwnerById.get(selected.clientId) ?? '') : ''}
              demo={demo}
              canDecide={canDecide}
              busy={busyId !== null}
              onApprove={approve}
              onReturn={returnItem}
              onReassign={reassign}
              returnRequestKey={returnRequestKey}
            />
          </div>
        </div>
      </div>

      {/* Footer stats strip (fixture demo presentation only) */}
      {demo && (
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
      )}

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        subjectMode={subjectMode}
        onSubmitted={() => {
          notify('Submitted for review', 'success');
          refetch();
        }}
      />
    </div>
  );
}
