import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, RefreshCw, Sparkles } from 'lucide-react';
import StatusPill from '@/components/StatusPill';
import { prefersReducedMotion } from '@/components/CountUp';
import { useDemoStore } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

interface AttentionItem {
  client: string;
  compliance: string;
  reason: string;
  status: string;
  action: { label: string; to?: string; remindClientId?: string };
}

/** PRD §137 — the five things CAOS puts in front of the partner each morning. */
const ATTENTION: AttentionItem[] = [
  {
    client: 'ABC Pvt Ltd', compliance: 'GSTR-3B',
    reason: 'Filing due in 3 days — 2 reconciliation differences unresolved.',
    status: 'At Risk', action: { label: 'Open', to: '/compliance/abc-gstr3b' },
  },
  {
    client: 'XYZ LLP', compliance: 'Tax Audit',
    reason: 'Manager review complete — awaiting partner sign-off.',
    status: 'Under Review', action: { label: 'Review', to: '/review' },
  },
  {
    client: 'PQR Industries', compliance: 'DSC',
    reason: 'Digital signature certificate expires in 9 days.',
    status: 'At Risk', action: { label: 'Remind', remindClientId: 'c-pqr' },
  },
  {
    client: 'LMN Ltd', compliance: 'GST Notice',
    reason: 'Response to the department notice is due within 7 days.',
    status: 'Critical', action: { label: 'Open', to: '/compliance/lmn-gst-notice' },
  },
  {
    client: 'RST Pvt Ltd', compliance: 'Fee invoice ₹1.2 L',
    reason: 'Invoice unpaid — 74 days overdue.',
    status: 'Overdue', action: { label: 'View alert', to: '/alerts' },
  },
];

/**
 * Section 3 — "What needs my attention today?" AI morning answer.
 * Rows stream in sequentially (0.35s cadence); refresh replays the stream.
 */
export default function AttentionList() {
  const navigate = useNavigate();
  const { sendReminder } = useDemoStore();
  const [runId, setRunId] = useState(0);
  const [visible, setVisible] = useState(() => (prefersReducedMotion() ? ATTENTION.length : 0));
  const [reminded, setReminded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timers = [window.setTimeout(() => setVisible(0), 0)];
    for (let i = 1; i <= ATTENTION.length; i++) {
      timers.push(window.setTimeout(() => setVisible(i), 350 * i));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [runId]);

  const streaming = visible < ATTENTION.length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
      aria-label="What needs my attention today"
      className="relative overflow-hidden rounded-xl border border-violet/25 bg-card shadow-card"
    >
      {/* One-shot violet shimmer across the card */}
      <motion.div
        key={runId}
        initial={{ x: '-100%' }}
        animate={{ x: '100%' }}
        transition={{ duration: 1.1, delay: 0.15, ease: 'easeInOut' }}
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(105,65,198,0.10) 50%, transparent 60%)' }}
        aria-hidden
      />

      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-soft text-violet">
          <Sparkles className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="text-caption text-violet">Ask CAOS · Morning Answer</span>
        <span className="flex-1" />
        <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">Generated 8:58 AM</span>
        <button
          type="button"
          onClick={() => setRunId((r) => r + 1)}
          aria-label="Replay morning answer"
          title="Replay morning answer"
          className="rounded-md p-1.5 text-ink-3 transition-all hover:bg-violet-soft hover:text-violet active:rotate-180"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <ol className="divide-y divide-line/60">
        {ATTENTION.slice(0, visible).map((item, i) => (
          <motion.li
            key={`${runId}-${item.client}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-brand-soft/40"
          >
            <span className="w-6 shrink-0 text-center font-display text-[18px] leading-6 text-gold tnum">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-5">
                <span className="font-semibold text-ink">{item.client}</span>
                <span className="text-ink-3"> — </span>
                <span className="font-medium text-ink">{item.compliance}</span>
              </p>
              <p className="mt-0.5 truncate text-[12.5px] leading-4 text-ink-2">{item.reason}</p>
            </div>
            <StatusPill status={item.status} size="sm" className="hidden sm:inline-flex" />
            <button
              type="button"
              onClick={() => {
                if (item.action.remindClientId) {
                  sendReminder(item.action.remindClientId);
                  setReminded((s) => ({ ...s, [item.client]: true }));
                } else if (item.action.to) {
                  navigate(item.action.to);
                }
              }}
              disabled={Boolean(item.action.remindClientId && reminded[item.client])}
              className={cn(
                'flex w-[86px] shrink-0 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all',
                item.action.remindClientId && reminded[item.client]
                  ? 'border-success/40 bg-success-soft text-success'
                  : 'border-line bg-card text-brand hover:border-brand/40 hover:bg-brand-soft',
              )}
            >
              {item.action.remindClientId && reminded[item.client] ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Sent
                </>
              ) : (
                item.action.label
              )}
            </button>
          </motion.li>
        ))}
        {streaming && (
          <li className="flex items-center gap-2 px-5 py-3.5" aria-live="polite">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet [animation-delay:300ms]" />
            <span className="ml-1 text-[12px] text-ink-3">CAOS is prioritising…</span>
          </li>
        )}
      </ol>
    </motion.section>
  );
}
