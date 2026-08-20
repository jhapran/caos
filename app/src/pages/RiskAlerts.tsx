import { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import StatusPill from '@/components/StatusPill';
import Tabs from '@/components/Tabs';
import { useDemoStore } from '@/data';
import { cn } from '@/lib/utils';
import AlertDrawer, { EntityPreview, SeverityIcon } from './alerts/AlertDrawer';
import { ALERT_CONTENT, ALERT_RULES, RESOLVED_ALERTS, SEVERITY_META } from './alerts/alertContent';
import type { AlertContent, AlertSeverityBand } from './alerts/alertContent';

/** Pulsing dot on the "last scan" caption + critical chip (isolated perpetual animation). */
const PulseDot = memo(function PulseDot({ className }: { className?: string }) {
  return (
    <motion.span
      className={cn('inline-block h-2 w-2 rounded-full', className)}
      animate={{ opacity: [1, 0.35, 1], scale: [1, 0.8, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
});

function RuleToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('relative w-10 shrink-0 rounded-full transition-colors', on ? 'bg-brand' : 'bg-ink-3/40')}
      style={{ height: 22 }}
    >
      <motion.span
        layout
        transition={{ type: 'spring', duration: 0.25, bounce: 0.2 }}
        className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-card', on ? 'right-[3px]' : 'left-[3px]')}
      />
    </button>
  );
}

/** Firm Risk Alerts — severity triage with explainable detail drawers. */
export default function RiskAlerts() {
  const { alerts, acknowledgeAlert, resolveAlert, notify } = useDemoStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(searchParams.get('alert'));
  const [tab, setTab] = useState('active');
  const [rules, setRules] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALERT_RULES.map((r) => [r.id, r.defaultOn])),
  );
  const navigate = useNavigate();

  // Support ?alert= deep-links changing while mounted.
  useEffect(() => {
    const id = searchParams.get('alert');
    if (id) setOpenId(id);
  }, [searchParams]);

  const statusOf = (id: string) => alerts.find((a) => a.id === id)?.status ?? 'active';

  const visible = useMemo(() => {
    const order: Record<AlertSeverityBand, number> = { critical: 0, high: 1, watch: 2 };
    return [...ALERT_CONTENT].sort((a, b) => order[a.severity] - order[b.severity]);
  }, []);

  const liveAlerts = visible.filter((a) => statusOf(a.id) !== 'resolved');
  const activeAlerts = visible.filter((a) => statusOf(a.id) === 'active');

  const severityCounts = useMemo(() => {
    const counts: Record<AlertSeverityBand, number> = { critical: 0, high: 0, watch: 0 };
    for (const a of liveAlerts) counts[a.severity] += 1;
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);

  const openAlert = (id: string) => {
    setOpenId(id);
    setSearchParams({ alert: id }, { replace: true });
  };
  const closeAlert = () => {
    setOpenId(null);
    setSearchParams({}, { replace: true });
  };

  const resolve = (id: string) => {
    resolveAlert(id);
    closeAlert();
  };
  const snooze = (id: string) => {
    acknowledgeAlert(id);
    notify('Snoozed for 24 hours', 'info');
    closeAlert();
  };

  const primary = (a: AlertContent) => {
    const act = a.primaryAction;
    if (act.kind === 'navigate' && act.href) navigate(act.href);
    else if (act.kind === 'drawer') openAlert(a.id);
    else if (act.kind === 'toast' && act.toast) notify(act.toast, 'success');
  };

  const openContent = ALERT_CONTENT.find((a) => a.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-[960px]">
      {/* Section 1 — Header + severity band */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">Firm Risk Alerts</h1>
        <p className="mt-1 text-[14px] text-ink-2">Continuously monitored across clients, team, and billing.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.06, ease: 'easeOut' }}
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        {(['critical', 'high', 'watch'] as const).map((sev, i) => (
          <motion.span
            key={sev}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: 0.1 + i * 0.06 }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
              SEVERITY_META[sev].chip,
            )}
          >
            {sev === 'critical' ? (
              <PulseDot className={SEVERITY_META[sev].dot} />
            ) : (
              <span className={cn('h-2 w-2 rounded-full', SEVERITY_META[sev].dot)} />
            )}
            {severityCounts[sev]} {SEVERITY_META[sev].label}
          </motion.span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-ink-3">
          <PulseDot className="bg-brand" /> Last scan 09:12 · every 15 min
        </span>
      </motion.div>

      {/* Section 2 — Alert cards */}
      <div className="mt-6 space-y-4">
        <AnimatePresence initial={false}>
          {liveAlerts.map((a, i) => {
            const status = statusOf(a.id);
            return (
              <motion.article
                key={a.id}
                layout="position"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
                transition={{ duration: 0.5, delay: 0.12 + i * 0.09, ease: 'easeOut' }}
                className={cn(
                  'cursor-pointer rounded-xl border border-line bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-lift',
                  SEVERITY_META[a.severity].border,
                  a.severity === 'critical' && status === 'active' && 'animate-gold-pulse',
                )}
                onClick={() => openAlert(a.id)}
              >
                <div className="flex items-start gap-3">
                  <SeverityIcon alert={a} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-[15px] font-semibold leading-6 text-ink">{a.title}</h2>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusPill
                          status={status === 'active' ? 'Pending' : 'At Risk'}
                          size="sm"
                          className={status === 'active' ? '!bg-critical-soft !text-critical [&_span]:!bg-critical' : ''}
                        />
                        <ChevronRight className="h-4 w-4 text-ink-3 transition-transform duration-200" />
                      </div>
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-3">
                      {a.age} · rule <span className="font-mono">{a.rule}</span>
                    </div>
                    <p className="mt-2 text-[13px] leading-5 text-ink-2">
                      <span className="font-mono font-semibold text-ink tnum">{a.bodyStrong}</span> {a.bodyText}
                    </p>
                    <div className="mt-3">
                      <EntityPreview alert={a} />
                    </div>
                    <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => primary(a)}
                        className="rounded-lg bg-brand px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-deep"
                      >
                        {a.primaryAction.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => openAlert(a.id)}
                        className="rounded-lg border border-line bg-card px-3.5 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                      >
                        Open details
                      </button>
                    </div>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Section 4 — Active / Resolved / Rules */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.3, ease: 'easeOut' }}
        className="mt-8"
      >
        <Tabs
          items={[
            { id: 'active', label: 'Active', count: activeAlerts.length },
            { id: 'resolved', label: 'Resolved', count: RESOLVED_ALERTS.length },
            { id: 'rules', label: 'Alert rules' },
          ]}
          active={tab}
          onChange={setTab}
        />
        <AnimatePresence mode="wait">
          {tab === 'resolved' && (
            <motion.ul
              key="resolved"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4 space-y-2"
            >
              {RESOLVED_ALERTS.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-card px-4 py-2.5 opacity-70"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <span className="flex-1 text-[13px] font-medium text-ink-2 line-through decoration-ink-3/40">
                    {r.title}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    Resolved by {r.resolvedBy} · {r.resolvedOn}
                  </span>
                </li>
              ))}
            </motion.ul>
          )}
          {tab === 'rules' && (
            <motion.ul
              key="rules"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4 space-y-2"
            >
              {ALERT_RULES.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-line bg-card px-4 py-3"
                >
                  <div>
                    <div className="font-mono text-[12px] font-medium text-ink">{r.label}</div>
                    <div className="mt-0.5 text-[11px] text-ink-3">{r.description}</div>
                  </div>
                  <RuleToggle
                    on={rules[r.id]}
                    onChange={(v) => {
                      setRules((m) => ({ ...m, [r.id]: v }));
                      notify(v ? `Rule enabled — ${r.label}` : `Rule paused — ${r.label}`, 'info');
                    }}
                    label={r.label}
                  />
                </li>
              ))}
            </motion.ul>
          )}
          {tab === 'active' && (
            <motion.div
              key="active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12px] text-ink-3"
            >
              {activeAlerts.length} active alert{activeAlerts.length === 1 ? '' : 's'} above — every one is explainable
              and has a recommended action.
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      <AlertDrawer alert={openContent} status={openContent ? statusOf(openContent.id) : 'active'} onClose={closeAlert} onResolve={resolve} onSnooze={snooze} />
    </div>
  );
}
