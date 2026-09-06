/**
 * IMP-042 (UI slice) — My Work (`/my-work`), live on the @/data boundary.
 *
 * Data: myworkService.getMyWork through useMyWork — the four DEC-L buckets
 * (Today / This Week / Waiting / Returned) over the caller's OWN
 * assigned/actionable work. In Supabase mode the adapter composes plain
 * RLS-protected reads scoped to the caller's live membership; billing and
 * no-membership users receive the empty contract and get a truthful empty
 * state here, never an error (API-ERR-02 collection semantics). In fixture
 * mode the demo bridge derives the buckets from the demo fixtures with the
 * pinned demo clock (TEN-22).
 *
 * Freshness is API-RT-02: NO subscription — refetch-on-mutate and
 * refetch-on-focus only (useMyWork owns the focus listener).
 *
 * Mutations (TEST-E2E-07 enablement): task-kind items offer the DM-SM-05
 * forward edges from their current status through taskService.transitionTask
 * — the ONLY status-change path — with the mandatory waiting-reason dialog
 * (DM-SM-05; the server rejects empty reasons and so does the dialog), plus
 * reassignment through taskService.updateTask's assigneeMembershipId patch,
 * manager+ only (RLS-TSK-01 presentation mirror). Review exits (submitted →
 * approved/returned) stay on the Review Queue — four-eyes reviewer-only.
 * Nothing is optimistic (API-MUT-02): buckets re-read after the command
 * confirms; `already_applied` replays surface without error styling
 * (API-MUT-03); ApiError kinds map to truthful messages (API-ERR-01).
 *
 * Fixture mode has no mutable task store behind My Work (the demo bridge
 * reads the legacy demo fixtures), so task actions there are demo-only
 * previews — the same demo-hint discipline as the Review Queue's demo-only
 * reassign affordance.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  Hourglass,
  RotateCcw,
} from 'lucide-react';

import Breadcrumb from '@/components/Breadcrumb';
import EmptyState from '@/components/EmptyState';
import { useShellIdentity } from '@/hooks/useShellIdentity';
import { ApiError, DEMO_TODAY, getDataSource, kolkataBusinessDate, taskService, useDemoStore } from '@/data';
import type { MembershipRole, MyWorkBuckets, MyWorkItem } from '@/data';
import ReassignDialog from './mywork/ReassignDialog';
import { useMyWork } from './mywork/useMyWork';
import WaitingDialog from './mywork/WaitingDialog';
import WorkItemRow from './mywork/WorkItemRow';
import type { TransitionAction } from './mywork/WorkItemRow';

/** RLS-TSK-01 presentation mirror: responsibility memberships are manager+
 *  writable. The server write guard stays authoritative. */
const REASSIGN_ROLES = new Set<MembershipRole>(['super_admin', 'partner', 'manager']);

const BUCKETS: {
  key: keyof MyWorkBuckets;
  label: string;
  icon: typeof CalendarCheck2;
  hint: string;
}[] = [
  { key: 'today', label: 'Today', icon: CalendarCheck2, hint: 'Due today or overdue' },
  { key: 'thisWeek', label: 'This week', icon: CalendarRange, hint: 'Due by Sunday' },
  { key: 'waiting', label: 'Waiting', icon: Hourglass, hint: 'Blocked — reason recorded' },
  { key: 'returned', label: 'Returned', icon: RotateCcw, hint: 'Sent back for rework' },
];

/** API-ERR-01 kind → truthful message (API-ERR-02: a hidden/nonexistent
 *  task gets the same generic surface as a missing one). */
function mutationMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'not_found':
        return 'That task is no longer available';
      case 'unauthorized':
        return 'You are not authorized to change this task';
      case 'unauthenticated':
        return 'Your session has expired — sign in again';
      default:
        // validation / conflict / internal carry provider-neutral messages.
        return err.message;
    }
  }
  return 'The change could not be saved';
}

export default function MyWork() {
  const { notify } = useDemoStore();
  const demo = getDataSource() !== 'supabase';
  const shell = useShellIdentity();
  // Fixture mode = the single partner persona; Supabase mode = the live role.
  const role: MembershipRole | null = demo ? 'partner' : (shell?.role ?? null);
  const canReassign = role !== null && REASSIGN_ROLES.has(role);

  const { buckets, loading, error, refetch } = useMyWork();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [waitingFor, setWaitingFor] = useState<MyWorkItem | null>(null);
  const [reassignFor, setReassignFor] = useState<MyWorkItem | null>(null);

  // The DEC-L Asia/Kolkata business date — the pinned demo clock in fixture
  // mode (TEN-22), the real current business date in production.
  const businessDate = kolkataBusinessDate(demo ? DEMO_TODAY : new Date());

  // Transition command — never optimistic (API-MUT-02): in-flight disable,
  // then a fresh read after the RPC confirms (refetch-on-mutate, API-RT-02).
  const transition = async (item: MyWorkItem, action: TransitionAction) => {
    if (demo) {
      notify(`${action.label} is a demo-only preview — the demo tasks are unchanged`, 'info');
      return;
    }
    if (item.taskId === null) return;
    setBusyId(item.id);
    try {
      const result = await taskService.transitionTask(item.taskId, action.input);
      if (result.status === 'already_applied') {
        notify('That change was already applied', 'info');
      } else {
        notify(action.successLabel, 'success');
      }
      refetch();
    } catch (err) {
      notify(mutationMessage(err), 'critical');
      refetch();
    } finally {
      setBusyId(null);
    }
  };

  const markWaiting = (reason: string) => {
    const item = waitingFor;
    setWaitingFor(null);
    if (!item) return;
    void transition(item, {
      key: 'waiting',
      label: 'Mark waiting',
      icon: Hourglass,
      input: { targetStatus: 'waiting', waitingReason: reason },
      successLabel: 'Marked as waiting',
    });
  };

  // Reassignment — taskService.updateTask's assigneeMembershipId patch
  // (RLS-TSK-01 manager+; the control itself is role-gated above).
  const reassign = async (assigneeMembershipId: string) => {
    const item = reassignFor;
    setReassignFor(null);
    if (!item || item.taskId === null) return;
    if (demo) {
      notify('Reassign is a demo-only preview — the demo tasks are unchanged', 'info');
      return;
    }
    setBusyId(item.id);
    try {
      await taskService.updateTask(item.taskId, { assigneeMembershipId });
      notify('Task reassigned', 'success');
      refetch();
    } catch (err) {
      notify(mutationMessage(err), 'critical');
      refetch();
    } finally {
      setBusyId(null);
    }
  };

  const total = buckets
    ? buckets.today.length + buckets.thisWeek.length + buckets.waiting.length + buckets.returned.length
    : 0;

  return (
    <div>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
        <Breadcrumb items={[{ label: 'Command Centre', href: '/command' }, { label: 'My Work' }]} />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">My Work</h1>
            <p className="mt-1 text-[13px] text-ink-2">
              <span className="font-semibold text-ink tnum">{total} {total === 1 ? 'item' : 'items'} across your buckets</span>
              <span className="text-ink-3">
                {' '}· business date <span className="font-mono tnum">{businessDate}</span> (Asia/Kolkata)
              </span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* Buckets */}
      {loading ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-20 text-center">
          <p className="text-[14px] font-medium text-ink">Loading your work…</p>
          <p className="mt-1 text-[13px] text-ink-3">Reading your assigned items.</p>
        </div>
      ) : error ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-20 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-critical-soft">
            <AlertCircle className="h-5 w-5 text-critical" strokeWidth={1.8} />
          </span>
          <p className="mt-4 text-[14px] font-medium text-ink">Could not load My Work</p>
          <p className="mt-1 text-[13px] text-ink-3">{error.message}</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-4 rounded-lg border border-line bg-card px-4 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
          >
            Retry
          </button>
        </div>
      ) : total === 0 ? (
        // The truthful empty state — billing / no-membership users receive
        // the empty contract from the service; this is expected, not an error.
        <div className="mt-6">
          <EmptyState
            icon={CheckCircle2}
            title="Nothing assigned to you right now"
            description="Work assigned to you — tasks due today or this week, blocked items, and returned reviews — will appear here. Billing and non-staff roles have no My Work scope, so this empty state is expected for them."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {buckets &&
            BUCKETS.map((bucket, i) => {
              const items = buckets[bucket.key];
              return (
                <motion.section
                  key={bucket.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.3 }}
                  aria-label={bucket.label}
                >
                  <div className="flex items-center gap-2">
                    <bucket.icon className="h-4 w-4 text-brand" strokeWidth={1.8} />
                    <h2 className="text-[14px] font-semibold text-ink">{bucket.label}</h2>
                    <span className="rounded-full bg-paper-deep px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-2 tnum">
                      {items.length}
                    </span>
                    <span className="text-[11px] text-ink-3">{bucket.hint}</span>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {items.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-line bg-card px-4 py-6 text-center text-[12.5px] text-ink-3">
                        Nothing here.
                      </p>
                    ) : (
                      items.map((item) => (
                        <WorkItemRow
                          key={item.id}
                          item={item}
                          businessDate={businessDate}
                          canReassign={canReassign}
                          busy={busyId === item.id}
                          onTransition={(it, action) => void transition(it, action)}
                          onMarkWaiting={setWaitingFor}
                          onReassign={setReassignFor}
                        />
                      ))
                    )}
                  </div>
                </motion.section>
              );
            })}
        </div>
      )}

      <WaitingDialog
        open={waitingFor !== null}
        onOpenChange={(open) => !open && setWaitingFor(null)}
        taskTitle={waitingFor?.title ?? ''}
        busy={busyId !== null}
        onConfirm={markWaiting}
      />
      <ReassignDialog
        open={reassignFor !== null}
        onOpenChange={(open) => !open && setReassignFor(null)}
        taskTitle={reassignFor?.title ?? ''}
        busy={busyId !== null}
        onConfirm={(membershipId) => void reassign(membershipId)}
      />
    </div>
  );
}
