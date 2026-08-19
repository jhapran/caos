import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Check, CheckCircle2, ChevronDown, Sparkles } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Drawer from '@/components/Drawer';
import StatusPill from '@/components/StatusPill';
import { getClient, ownerOf, REVIEW_ITEMS, TEAM, useDemoStore } from '@/data';
import { cn } from '@/lib/utils';
import type { AlertContent } from './alertContent';
import { RECEIVABLES, RECEIVABLES_TOTAL, SEVERITY_META } from './alertContent';

const inr = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')} L` : `₹${n.toLocaleString('en-IN')}`;

type ExecState = 'idle' | 'confirm' | 'running' | 'done';

/** Alert detail Drawer — why this fired, affected entities, executable recommended action. */
export default function AlertDrawer({
  alert,
  status,
  onClose,
  onResolve,
  onSnooze,
}: {
  alert: AlertContent | null;
  status: 'active' | 'acknowledged' | 'resolved';
  onClose: () => void;
  onResolve: (id: string) => void;
  onSnooze: (id: string) => void;
}) {
  const { notify } = useDemoStore();
  const navigate = useNavigate();
  const [exec, setExec] = useState<ExecState>('idle');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setExec('idle');
    setProgress(0);
  }, [alert?.id]);

  // Tick the execute progress chips 0.05s apart.
  useEffect(() => {
    if (exec !== 'running' || !alert?.execute) return;
    if (progress >= alert.execute.ticks) {
      const t = window.setTimeout(() => {
        setExec('done');
        notify(alert.execute!.toast, 'success');
      }, 250);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setProgress((p) => p + 1), 90);
    return () => window.clearTimeout(t);
  }, [exec, progress, alert, notify]);

  const queue = useMemo(() => REVIEW_ITEMS.filter((r) => r.status === 'pending').slice(0, 9), []);
  const reassignTargets = TEAM.filter((t) => t.id !== 'u-pranav');

  const meta = alert ? SEVERITY_META[alert.severity] : null;

  return (
    <Drawer
      open={!!alert}
      onClose={onClose}
      title={
        alert && meta ? (
          <span className="flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.chip)}>{meta.label}</span>
            <span>{alert.title}</span>
          </span>
        ) : undefined
      }
      subtitle={alert ? `${alert.detectedAt} · rule: ${alert.rule}` : undefined}
    >
      {alert && meta && (
        <div className="space-y-6 pb-16">
          {/* Why this fired */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="rounded-xl bg-paper-deep p-4"
          >
            <h3 className="text-caption">Why this fired</h3>
            <ul className="mt-3 space-y-2.5">
              {alert.why.map((w, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] leading-5 text-ink-2">
                  <w.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                  {w.text}
                </li>
              ))}
            </ul>
          </motion.section>

          {/* Affected entities */}
          {alert.id !== 'a-05' && alert.id !== 'a-02' && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.07, ease: 'easeOut' }}
            >
              <h3 className="text-caption">Affected — {alert.affectedLabel}</h3>
              <div className="mt-2 overflow-hidden rounded-xl border border-line">
                <table className="w-full text-[12px] leading-5">
                  <thead>
                    <tr className="bg-paper-deep/70 text-left">
                      <th className="px-3 py-2 text-caption">Client</th>
                      <th className="px-3 py-2 text-caption">Owner</th>
                      <th className="px-3 py-2 text-right text-caption">Risk</th>
                      <th className="px-3 py-2 text-caption">Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alert.entities.map((e) => {
                      const c = getClient(e.clientId);
                      if (!c) return null;
                      return (
                        <tr
                          key={e.clientId}
                          onClick={() => navigate(`/compliance/${e.clientId}`)}
                          className="cursor-pointer border-t border-line/60 transition-colors hover:bg-brand-soft/40"
                        >
                          <td className="px-3 py-2 font-medium text-ink">{c.name}</td>
                          <td className="px-3 py-2 text-ink-2">{ownerOf(c.ownerId).name.replace(/^CA /, '')}</td>
                          <td className="px-3 py-2 text-right font-mono tnum text-ink">{e.risk}</td>
                          <td className="px-3 py-2 text-ink-2">{e.missing}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {alert.affectedTotal > alert.entities.length && (
                <button
                  type="button"
                  onClick={() => alert.primaryAction.href && navigate(alert.primaryAction.href)}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline hover:decoration-gold hover:underline-offset-2"
                >
                  View all {alert.affectedTotal} <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </motion.section>
          )}

          {/* a-02 — rebalance UI */}
          {alert.id === 'a-02' && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.07, ease: 'easeOut' }}
            >
              <h3 className="text-caption">Reassign queued reviews</h3>
              <ul className="mt-2 space-y-2">
                {queue.map((r) => {
                  const c = getClient(r.clientId);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-ink">{r.title}</div>
                        <div className="text-[11px] text-ink-3">
                          {c?.name} · {r.type}
                        </div>
                      </div>
                      <div className="relative shrink-0">
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            const member = TEAM.find((t) => t.id === e.target.value);
                            if (member) notify(`Reassigned to ${member.name}`, 'success');
                          }}
                          className="appearance-none rounded-md border border-line bg-card py-1 pl-2 pr-6 text-[11px] font-medium text-ink-2 focus:border-brand/50 focus:outline-none"
                        >
                          <option value="" disabled>
                            Reassign…
                          </option>
                          {reassignTargets.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-3" />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] text-ink-3">
                Reassigning 5 items to Priya and 2 to Rahul brings Pranav under 90% capacity.
              </p>
            </motion.section>
          )}

          {/* a-05 — receivables list */}
          {alert.id === 'a-05' && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.07, ease: 'easeOut' }}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-caption">Receivables &gt; 90 days</h3>
                <span className="font-mono text-[12px] font-semibold text-critical tnum">{inr(RECEIVABLES_TOTAL)}</span>
              </div>
              <div className="mt-2 overflow-hidden rounded-xl border border-line">
                <table className="w-full text-[12px] leading-5">
                  <thead>
                    <tr className="bg-paper-deep/70 text-left">
                      <th className="px-3 py-2 text-caption">Invoice #</th>
                      <th className="px-3 py-2 text-caption">Client</th>
                      <th className="px-3 py-2 text-right text-caption">Amount</th>
                      <th className="px-3 py-2 text-right text-caption">Days</th>
                      <th className="px-3 py-2 text-caption">Follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RECEIVABLES.map((r) => (
                      <tr key={r.invoice} className="border-t border-line/60">
                        <td className="px-3 py-2 font-mono text-[11px] text-ink-2">{r.invoice}</td>
                        <td className="px-3 py-2 font-medium text-ink">{getClient(r.clientId)?.name}</td>
                        <td className="px-3 py-2 text-right font-mono tnum text-ink">{inr(r.amount)}</td>
                        <td className="px-3 py-2 text-right font-mono tnum text-critical">{r.days}</td>
                        <td className="px-3 py-2 text-ink-3">{r.lastFollowUp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => notify('Statement of account sent to 11 clients', 'success')}
                className="mt-3 rounded-lg bg-brand px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-deep"
              >
                Send statement
              </button>
            </motion.section>
          )}

          {/* Recommended action */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.14, ease: 'easeOut' }}
            className="rounded-xl border border-brand/25 bg-brand-soft p-4"
          >
            <h3 className="flex items-center gap-1.5 text-caption !text-brand">
              <Sparkles className="h-3.5 w-3.5 text-violet" /> Recommended action
            </h3>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">{alert.recommendation}</p>

            {alert.execute && (
              <div className="mt-3">
                {exec === 'idle' && (
                  <button
                    type="button"
                    onClick={() => setExec('confirm')}
                    className="rounded-lg bg-brand px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-deep"
                  >
                    Execute
                  </button>
                )}
                {exec === 'confirm' && (
                  <div className="flex items-center gap-2 rounded-lg border border-brand/30 bg-card px-3 py-2">
                    <span className="flex-1 text-[12px] font-medium text-ink">
                      Run this now? {alert.execute.ticks} {alert.execute.tickLabel}.
                    </span>
                    <button
                      type="button"
                      onClick={() => setExec('running')}
                      className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-deep"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setExec('idle')}
                      className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {(exec === 'running' || exec === 'done') && (
                  <div>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: alert.execute.ticks }).map((_, i) => (
                        <motion.span
                          key={i}
                          initial={false}
                          animate={{
                            backgroundColor: i < progress ? '#0E5F52' : '#EFECE5',
                            color: i < progress ? '#FFFFFF' : '#98A2B3',
                          }}
                          transition={{ duration: 0.2 }}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold tnum"
                        >
                          {i < progress ? <Check className="h-3 w-3" /> : i + 1}
                        </motion.span>
                      ))}
                    </div>
                    <div className="mt-2 text-[11px] font-medium text-ink-2 tnum">
                      {Math.min(progress, alert.execute.ticks)}/{alert.execute.ticks} {alert.execute.tickLabel}
                      {exec === 'done' && <span className="ml-2 text-success">· complete</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.section>

          {/* Footer actions */}
          <div className="sticky -bottom-5 -mx-6 mt-6 flex items-center gap-2 border-t border-line bg-card px-6 py-3">
            <button
              type="button"
              onClick={() => onResolve(alert.id)}
              disabled={status === 'resolved'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:border-success/50 hover:text-success disabled:opacity-40"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {status === 'resolved' ? 'Resolved' : 'Mark as resolved'}
            </button>
            <button
              type="button"
              onClick={() => onSnooze(alert.id)}
              disabled={status !== 'active'}
              className="rounded-lg border border-line bg-card px-3.5 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:border-ink-3/50 hover:text-ink disabled:opacity-40"
            >
              Snooze 24h
            </button>
            <span className="ml-auto">
              <StatusPill
                status={status === 'active' ? 'Pending' : status === 'acknowledged' ? 'At Risk' : 'Approved'}
                size="sm"
              />
            </span>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** Severity icon chip used on the alert cards. */
export function SeverityIcon({ alert }: { alert: AlertContent }) {
  const meta = SEVERITY_META[alert.severity];
  return (
    <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', meta.iconChip)}>
      <alert.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
    </span>
  );
}

/** Small affected-entities avatar preview used on cards. */
export function EntityPreview({ alert }: { alert: AlertContent }) {
  return (
    <div className="flex items-center gap-1.5">
      {alert.entities.slice(0, 3).map((e) => {
        const c = getClient(e.clientId);
        if (!c) return null;
        return (
          <span
            key={e.clientId}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-ink-2"
          >
            <Avatar name={c.name} size="xs" />
            {c.name.split(' ').slice(0, 2).join(' ')}
          </span>
        );
      })}
      {alert.affectedTotal > 3 && (
        <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-medium text-ink-3 tnum">
          +{alert.affectedTotal - 3} more
        </span>
      )}
    </div>
  );
}
