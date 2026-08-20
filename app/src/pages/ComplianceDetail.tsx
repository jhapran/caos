// Compliance Detail (`/compliance/:id`) — the PRD §85/§86 explainability showcase.
// Never a bare status: reason, owner, last action, and a risk score that shows
// its arithmetic. "Mark received" re-scores the risk live — the key demo beat.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CalendarClock,
  Check,
  FileQuestion,
  Receipt,
  Send,
  ShieldAlert,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Breadcrumb from '@/components/Breadcrumb';
import EmptyState from '@/components/EmptyState';
import StatusPill from '@/components/StatusPill';
import WorkflowStepper from '@/components/WorkflowStepper';
import {
  complianceName,
  daysUntil,
  getClient,
  getCompliance,
  getTask,
  getTasksForClient,
  ownerOf,
  TEAM,
  withLatency,
  useDemoStore,
} from '@/data';
import type { Client, TaskInstance } from '@/data';
import DocumentChecklist from './compliance/DocumentChecklist';
import type { DocRow } from './compliance/DocumentChecklist';
import RiskBreakdown from './compliance/RiskBreakdown';
import type { DisplayFactor } from './compliance/RiskBreakdown';
import { dueLabel, fmtDate, joinList, relTo, demoNowIso } from './deadlines/utils';
import { cn } from '@/lib/utils';

interface Note {
  at: string;
  by: string;
  text: string;
}

interface TimelineEvent {
  at: string;
  text: string;
  kind: 'milestone' | 'reminder' | 'doc' | 'note';
}

const EXPECTED_DOCS: Record<string, string[]> = {
  GST: ['Sales register', 'Purchase register', 'Bank statement'],
  TDS: ['TDS challans', 'Form 16A', '26AS statement', 'Salary register'],
  'Income Tax': ['26AS statement', 'Bank statement', 'Trial balance'],
  Audit: ['Trial balance', 'Fixed asset register', 'Bank statement'],
  MCA: ['Financial statements', 'Board resolution', 'Director KYC (DIR-3)'],
  Payroll: ['Salary register', 'PF challans', 'ESI challans'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Resolve a route id — a task id, or a client id (⌘K palette links) → their most urgent pending task. */
function resolveTask(id: string): { task?: TaskInstance; client?: Client } {
  const direct = getTask(id);
  if (direct) return { task: direct, client: getClient(direct.clientId) };
  const client = getClient(id);
  if (client) {
    const tasks = getTasksForClient(client.id);
    const pending = tasks
      .filter((t) => t.category !== 'completed')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const best =
      pending.find((t) => t.category === 'waiting') ?? pending.find((t) => t.atRisk) ?? pending[0] ?? tasks[0];
    return { task: best, client };
  }
  return {};
}

/** Build the document checklist for a task, folding seeded missing docs into per-category expectations. */
function buildChecklist(task: TaskInstance, category: string, received: string[]): DocRow[] {
  const rows: DocRow[] = [];
  if (category === 'GST') {
    rows.push({ key: 'auto-2a', name: 'GSTR-2A dump', note: 'auto-pulled from GSTN', state: 'received' });
  }
  const stateFor = (missingKey?: string): DocRow['state'] =>
    missingKey ? (received.includes(missingKey) ? 'unread' : 'missing') : 'received';

  const matched = new Set<string>();
  for (const doc of EXPECTED_DOCS[category] ?? EXPECTED_DOCS['GST']) {
    const missingKey = task.missingDocs.find(
      (m) => norm(m).includes(norm(doc)) || norm(doc).includes(norm(m.replace(/\s*\(.*\)/, ''))),
    );
    if (missingKey) matched.add(missingKey);
    rows.push({ key: doc, name: `${doc} — ${task.period}`, state: stateFor(missingKey), missingKey });
  }
  for (const m of task.missingDocs) {
    if (!matched.has(m)) rows.push({ key: m, name: `${m} — ${task.period}`, state: stateFor(m), missingKey: m });
  }
  // Deterministic "received, unread" flavour row when the client is mid-conversation.
  if (task.category === 'waiting' && !rows.some((r) => r.state === 'unread')) {
    const candidate = rows.find((r) => r.state === 'received' && !r.note);
    if (candidate) candidate.state = 'unread';
  }
  return rows;
}

/** Live re-score arithmetic: the document-driven factor loses points as docs arrive.
 *  Extracted so the gauge, the factor list, and the "mark received" toast all agree. */
function docScoring(task: TaskInstance): { docFactorIdx: number; perDoc: number } {
  const docFactorIdx = task.riskFactors.findIndex((f) =>
    /documents missing|awaiting client information/i.test(f.label),
  );
  const perDoc =
    docFactorIdx >= 0 && task.missingDocs.length > 0
      ? Math.max(1, Math.round(task.riskFactors[docFactorIdx].points / task.missingDocs.length))
      : 0;
  return { docFactorIdx, perDoc };
}

function scoreAfter(task: TaskInstance, receivedCount: number): number {
  const { docFactorIdx, perDoc } = docScoring(task);
  if (docFactorIdx < 0) return task.riskScore;
  const delta = Math.min(task.riskFactors[docFactorIdx].points, perDoc * receivedCount);
  return Math.max(0, task.riskScore - delta);
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-card p-6 shadow-card">
        <div className="h-3 w-56 animate-pulse rounded bg-paper-deep" />
        <div className="mt-4 flex items-center gap-4">
          <div className="h-11 w-11 animate-pulse rounded-full bg-paper-deep" />
          <div className="space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-paper-deep" />
            <div className="h-3 w-72 animate-pulse rounded bg-paper-deep" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-7">
          {[220, 260, 200].map((h, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-line bg-card shadow-card" style={{ height: h }} />
          ))}
        </div>
        <div className="space-y-6 xl:col-span-5">
          {[240, 160, 140].map((h, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-line bg-card shadow-card" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const sectionAnim = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: 'easeOut' as const, delay: i * 0.06 },
});

export default function ComplianceDetail() {
  const { id = '' } = useParams();
  // Remount on id change so per-task state (received docs, notes) resets cleanly.
  return <ComplianceDetailInner key={id} id={id} />;
}

function ComplianceDetailInner({ id }: { id: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { sendReminder, notify, reminders: storeReminders } = useDemoStore();

  const [task, setTask] = useState<TaskInstance | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [received, setReceived] = useState<string[]>([]);
  const [reminderSent, setReminderSent] = useState(false);
  const [localEvents, setLocalEvents] = useState<TimelineEvent[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let live = true;
    withLatency(resolveTask(id)).then(({ task: t, client: c }) => {
      if (!live) return;
      setTask(t ?? null);
      setClient(c ?? null);
      setLoading(false);
      if (t && c) {
        const reviewer = ownerOf(t.ownerId).id === 'u-priya' ? TEAM[0] : TEAM[1];
        setNotes([
          {
            at: new Date(Date.parse('2025-09-08T11:20:00+05:30')).toISOString(),
            by: reviewer.name,
            text: `${c.name.split(' ')[0]} promised the pending documents by Friday — follow up if not received.`,
          },
        ]);
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  // Deep-link: /compliance/:id#risk scrolls to the breakdown.
  useEffect(() => {
    if (!loading && location.hash === '#risk') {
      document.getElementById('risk')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading, location.hash]);

  const derived = useMemo(() => {
    if (!task || !client) return null;
    const master = getCompliance(task.complianceId);
    const owner = ownerOf(task.ownerId);
    const reviewer = owner.id === 'u-priya' ? TEAM[0] : TEAM[1];
    const daysLeft = daysUntil(task.dueDate);
    const statusLabel = task.atRisk ? 'At Risk' : task.state;

    // Live re-score: the document-driven factor loses points as docs arrive.
    const { docFactorIdx, perDoc } = docScoring(task);
    const totalMissing = task.missingDocs.length;
    const delta =
      docFactorIdx >= 0 ? Math.min(task.riskFactors[docFactorIdx].points, perDoc * received.length) : 0;
    const score = Math.max(0, task.riskScore - delta);

    const factors: DisplayFactor[] = task.riskFactors.map((f, i) => {
      if (i === docFactorIdx && delta > 0) {
        return {
          key: f.label,
          label: f.label,
          detail:
            received.length >= totalMissing
              ? 'Resolved — all documents received'
              : `${totalMissing - received.length} of ${totalMissing} still pending`,
          points: Math.max(0, f.points - delta),
          originalPoints: f.points,
        };
      }
      return { key: f.label, label: f.label, detail: f.detail, points: f.points };
    });

    const remainingDocs = task.missingDocs.filter((d) => !received.includes(d));
    const allReminders = [...task.reminders, ...(storeReminders[client.id] ?? [])].sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
    );
    const lastReminder = allReminders[allReminders.length - 1];
    const channels = [...new Set(allReminders.map((r) => r.channel))];

    const reason = remainingDocs.length
      ? `${remainingDocs[0]} for ${task.period} not received${remainingDocs.length > 1 ? ` (+${remainingDocs.length - 1} more)` : ''}.`
      : received.length > 0
        ? 'All requested documents received — processing can begin.'
        : task.atRisk
          ? 'Preparation has not started and the statutory date is close.'
          : task.category === 'completed'
            ? `Filed on ${task.filedAt ? fmtDate(task.filedAt) : 'time'} — no open items.`
            : `Work is underway (${task.state.toLowerCase()}).`;

    return {
      master,
      owner,
      reviewer,
      daysLeft,
      statusLabel,
      score,
      factors,
      remainingDocs,
      allReminders,
      lastReminder,
      channels,
      reason,
    };
  }, [task, client, received, storeReminders]);

  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!task || !derived) return [];
    const events: TimelineEvent[] = [];
    task.history.forEach((h, i) => {
      events.push({
        at: h.at,
        kind: 'milestone',
        text:
          i === 0
            ? `Task created · assigned to ${derived.owner.name}`
            : h.state === 'Information Requested' && task.missingDocs.length > 0
              ? `${h.actor} requested ${joinList(task.missingDocs.map((d) => d.toLowerCase()))}`
              : `${h.actor} moved to “${h.state}”`,
      });
    });
    derived.allReminders.forEach((r, k) => {
      events.push({ at: r.sentAt, kind: 'reminder', text: `Reminder #${k + 1} sent (${r.channel})${r.by === 'auto' ? ' — auto' : ''}` });
    });
    events.push(...localEvents);
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [task, derived, localEvents]);

  if (loading) return <DetailSkeleton />;

  if (!task || !client || !derived) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Compliance record not found"
        description="This task doesn't exist in the seeded demo data."
        action={{ label: 'Back to Deadlines', onClick: () => navigate('/deadlines') }}
      />
    );
  }

  const {
    master,
    owner,
    reviewer,
    daysLeft,
    statusLabel,
    score,
    factors,
    remainingDocs,
    allReminders,
    lastReminder,
    channels,
    reason,
  } = derived;

  const checklist = buildChecklist(task, master.category, received);
  const groupId = `${task.complianceId}::${task.period}`;
  const groupHref = `/deadlines/${encodeURIComponent(groupId)}/clients`;

  const markReceived = (row: DocRow) => {
    const missingKey = row.missingKey;
    if (!missingKey || received.includes(missingKey)) return;
    const next = [...received, missingKey];
    const newScore = scoreAfter(task, next.length);
    setReceived(next);
    setLocalEvents((ev) => [
      ...ev,
      {
        at: demoNowIso(ev.length),
        kind: 'doc',
        text: `${row.name} marked received · risk re-scored ${task.riskScore} → ${newScore}`,
      },
    ]);
    notify(`${row.name} marked received — risk re-scored to ${newScore}`);
  };

  const requestDoc = (row: DocRow) => {
    notify(`Requested "${row.name}" from ${client.name}`, 'info');
  };

  const onSendReminder = () => {
    sendReminder(client.id);
    setReminderSent(true);
    setLocalEvents((ev) => [...ev, { at: demoNowIso(ev.length), kind: 'reminder', text: 'Reminder sent (Email) — manual' }]);
  };

  const onEscalate = () => {
    notify(`Escalated to ${reviewer.name} (${reviewer.role})`, 'warning');
    setLocalEvents((ev) => [...ev, { at: demoNowIso(ev.length), kind: 'milestone', text: `Escalated to ${reviewer.name} (${reviewer.role})` }]);
  };

  const addNote = () => {
    const text = draft.trim();
    if (!text) return;
    const note = { at: demoNowIso(notes.length), by: 'CA Pranav Kumar', text };
    setNotes((n) => [...n, note]);
    setLocalEvents((ev) => [...ev, { at: note.at, kind: 'note', text: `Note added by ${note.by}` }]);
    setDraft('');
    notify('Note added');
  };

  // Client responsiveness — deterministic per client (seeded demo fixture).
  const hash = hashOf(client.id);
  const median = 2 + (hash % 5);
  const responseBars = Array.from({ length: 6 }, (_, k) => Math.max(1, median + ((hash >> (k * 3)) % 3) - 1));
  const responsivenessCaption =
    median >= 4 ? `Slower than ${70 + (hash % 15)}% of clients.` : `Faster than ${55 + (hash % 20)}% of clients.`;

  // Linked items — other tasks for this client, pending first.
  const linked = getTasksForClient(client.id)
    .filter((t) => t.id !== task.id)
    .sort((a, b) => Number(a.category === 'completed') - Number(b.category === 'completed') || b.dueDate.localeCompare(a.dueDate))
    .slice(0, 3);

  const card = 'rounded-xl border border-line bg-card p-5 shadow-card';
  const ghostBtn =
    'inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium text-ink-2 transition-colors';

  return (
    <div>
      {/* Section 1 — Header band */}
      <motion.section {...sectionAnim(0)} className={cn(card, 'p-6')}>
        <Breadcrumb
          items={[
            { label: 'Command Centre', href: '/command' },
            { label: 'Deadlines', href: '/deadlines' },
            { label: `${master.shortName} · ${task.period}`, href: groupHref },
            { label: client.name },
          ]}
        />
        <div className="mt-4 flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-start gap-4">
            <Avatar name={client.name} size="lg" />
            <div>
              <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">{client.name}</h1>
              <p className="mt-1 font-mono text-[12px] text-ink-2">
                {[client.gstin && `GSTIN ${client.gstin}`, client.pan && `PAN ${client.pan}`, client.cin && `CIN ${client.cin}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="neutral">{client.industry}</Badge>
                <Badge tone="neutral">{client.city}</Badge>
                <Badge tone="gold">Turnover {client.turnoverBand}</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-medium text-ink-2">
              {master.shortName} · {task.period}
            </span>
            <motion.span
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35, ease: 'backOut', delay: 0.15 }}
              className="inline-flex"
            >
              <motion.span
                initial={{ boxShadow: '0 0 0 0 rgba(199,116,20,0.5)' }}
                animate={{ boxShadow: '0 0 0 12px rgba(199,116,20,0)' }}
                transition={{ duration: 0.9, delay: 0.35 }}
                className="rounded-full"
              >
                <StatusPill status={statusLabel} size="md" className="px-3.5 py-1.5 text-[13px]" />
              </motion.span>
            </motion.span>
            <span
              className={cn(
                'flex items-center gap-1.5 text-[12px] font-medium',
                daysLeft <= 5 ? 'text-critical' : 'text-ink-2',
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {dueLabel(daysLeft)} · {fmtDate(task.dueDate)}
            </span>
          </div>
        </div>
      </motion.section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Main column (7) */}
        <div className="space-y-6 xl:col-span-7">
          {/* Section 2 — Explainable status (PRD §85) */}
          <motion.section {...sectionAnim(1)} className={card}>
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] leading-6 font-semibold text-ink">
                Why is this {statusLabel.toLowerCase()}?
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-soft px-2 py-0.5 text-[11px] font-medium text-violet">
                <Sparkles className="h-3 w-3" /> Explained by CAOS
              </span>
            </div>
            <div className="mt-4 rounded-xl bg-paper-deep p-5">
              <p className="font-display text-[18px] leading-6 italic text-ink">
                “{master.shortName} — {statusLabel}.”
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {[
                  ['Reason', reason],
                  [
                    'Client contacted',
                    allReminders.length
                      ? `${allReminders.length} time${allReminders.length === 1 ? '' : 's'} (${channels.join(' · ')})`
                      : 'Not yet contacted',
                  ],
                  [
                    'Last reminder',
                    lastReminder
                      ? `${fmtDate(lastReminder.sentAt)} — reminder #${allReminders.length} (${lastReminder.channel})`
                      : '—',
                  ],
                  ['Due', `${fmtDate(task.dueDate)} (statutory) — ${dueLabel(daysLeft).toLowerCase()}`],
                ].map(([label, value], i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut', delay: 0.25 + i * 0.06 }}
                  >
                    <dt className="text-caption">{label}</dt>
                    <dd className="mt-0.5 text-[14px] leading-5 text-ink">{value}</dd>
                  </motion.div>
                ))}
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut', delay: 0.49 }}
                >
                  <dt className="text-caption">Owner</dt>
                  <dd className="mt-1 flex items-center gap-2 text-[14px] text-ink">
                    <Avatar name={owner.name} size="xs" /> {owner.name}
                  </dd>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut', delay: 0.55 }}
                >
                  <dt className="text-caption">Reviewer</dt>
                  <dd className="mt-1 flex items-center gap-2 text-[14px] text-ink">
                    <Avatar name={reviewer.name} size="xs" /> {reviewer.name}
                  </dd>
                </motion.div>
              </dl>
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.6 }}
              className="mt-4 flex flex-wrap gap-2"
            >
              {reminderSent ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-3.5 py-2 text-[13px] font-medium text-success">
                  <Check className="h-4 w-4" /> Reminder sent
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onSendReminder}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"
                >
                  <Send className="h-4 w-4" /> Send reminder
                </button>
              )}
              <button type="button" onClick={onEscalate} className={cn(ghostBtn, 'hover:border-warning hover:text-warning-strong')}>
                <ShieldAlert className="h-4 w-4" /> Escalate
              </button>
              {remainingDocs.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const row = checklist.find((r) => r.state === 'missing');
                    if (row) markReceived(row);
                  }}
                  className={cn(ghostBtn, 'hover:border-success hover:bg-success-soft hover:text-success')}
                >
                  <Check className="h-4 w-4" /> Mark received
                </button>
              )}
            </motion.div>
          </motion.section>

          {/* Section 3 — Risk score breakdown (PRD §86) */}
          <motion.section {...sectionAnim(2)} className={card} id="risk">
            <h2 className="text-[17px] leading-6 font-semibold text-ink">Risk score breakdown</h2>
            <div className="mt-4">
              <RiskBreakdown score={score} factors={factors} />
            </div>
          </motion.section>

          {/* Section 4 — Progress: workflow stepper + activity timeline */}
          <motion.section {...sectionAnim(3)} className={card}>
            <h2 className="text-[17px] leading-6 font-semibold text-ink">Progress</h2>
            <div className="mt-5 overflow-x-auto pb-1">
              <div className="min-w-[720px]">
                <WorkflowStepper current={task.state} history={task.history} />
              </div>
            </div>
            <div className="mt-6 border-t border-line pt-5">
              <div className="text-caption">Activity</div>
              <ol className="relative mt-3 space-y-4 border-l border-line pl-5">
                {timeline.slice(0, 8).map((ev, i) => (
                  <motion.li
                    key={`${ev.at}-${i}`}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut', delay: Math.min(i * 0.08, 0.5) }}
                    className="relative"
                  >
                    <span
                      className={cn(
                        'absolute top-1 -left-[26px] h-2.5 w-2.5 rounded-full border-2 border-card',
                        ev.kind === 'reminder'
                          ? 'bg-warning'
                          : ev.kind === 'doc'
                            ? 'bg-success'
                            : ev.kind === 'note'
                              ? 'bg-gold'
                              : 'bg-brand',
                      )}
                    />
                    <div className="font-mono text-[11px] text-ink-3 tnum">
                      {fmtDate(ev.at)} · {relTo(ev.at)}
                    </div>
                    <div className="text-[13px] leading-5 text-ink">{ev.text}</div>
                  </motion.li>
                ))}
              </ol>
            </div>
          </motion.section>
        </div>

        {/* Right rail (5) */}
        <div className="space-y-6 xl:col-span-5">
          {/* Documents checklist */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.14 }}
            className={card}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-ink">Documents</h2>
              <Badge tone={remainingDocs.length > 0 ? 'critical' : 'brand'}>
                {remainingDocs.length > 0 ? `${remainingDocs.length} missing` : 'complete'}
              </Badge>
            </div>
            <div className="mt-2">
              <DocumentChecklist rows={checklist} onRequest={requestDoc} onMarkReceived={markReceived} />
            </div>
          </motion.section>

          {/* Client responsiveness */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.22 }}
            className={card}
          >
            <h2 className="text-[15px] font-semibold text-ink">Client responsiveness</h2>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-stat-xl text-ink">{median}d</div>
                <div className="text-[12px] text-ink-3">Median response time</div>
              </div>
              <div className="flex h-14 items-end gap-1.5">
                {responseBars.map((v, i) => (
                  <motion.span
                    key={i}
                    initial={{ height: 0 }}
                    animate={{ height: `${(v / Math.max(...responseBars)) * 100}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut', delay: 0.3 + i * 0.06 }}
                    className={cn('w-3 rounded-sm', v >= 5 ? 'bg-warning' : 'bg-brand/70')}
                    title={`${v} days`}
                  />
                ))}
              </div>
            </div>
            <p className="mt-2 text-[12px] text-ink-3">{responsivenessCaption}</p>
          </motion.section>

          {/* Linked items */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.3 }}
            className={card}
          >
            <h2 className="text-[15px] font-semibold text-ink">Linked items</h2>
            <ul className="mt-2 space-y-1.5">
              {linked.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/compliance/${t.id}`}
                    className="flex items-center justify-between rounded-lg border border-line px-3 py-2 transition-colors hover:border-brand hover:bg-brand-soft/40"
                  >
                    <span className="text-[13px] font-medium text-ink">
                      {complianceName(t.complianceId)} · {t.period}
                    </span>
                    <StatusPill status={t.atRisk ? 'At Risk' : t.state} size="sm" />
                  </Link>
                </li>
              ))}
              {hash % 2 === 0 && (
                <li>
                  <Link
                    to="/alerts"
                    className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 transition-colors hover:border-warning"
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium text-warning-strong">
                      <Receipt className="h-3.5 w-3.5" /> Open invoice
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-warning-strong tnum">₹1.2 L · 74 days</span>
                  </Link>
                </li>
              )}
            </ul>
          </motion.section>

          {/* Notes */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.38 }}
            className={card}
          >
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
              <StickyNote className="h-4 w-4 text-ink-3" /> Notes
            </h2>
            <ul className="mt-3 space-y-3">
              {notes.map((n, i) => (
                <motion.li
                  key={`${n.at}-${i}`}
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="rounded-lg bg-paper-deep/60 px-3 py-2"
                >
                  <div className="text-[13px] leading-5 text-ink">“{n.text}”</div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {n.by} · {fmtDate(n.at)}
                  </div>
                </motion.li>
              ))}
            </ul>
            <div className="mt-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="Add a note for the team…"
                className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-gold"
              />
              <button
                type="button"
                onClick={addNote}
                disabled={!draft.trim()}
                className="mt-2 rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-deep disabled:opacity-40"
              >
                Add note
              </button>
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
