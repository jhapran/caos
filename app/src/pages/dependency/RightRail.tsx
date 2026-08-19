import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, MessageCircle, Phone, TrendingUp } from 'lucide-react';
import { useDemoStore } from '@/data';
import { cn } from '@/lib/utils';
import Meter from './Meter';
import { DOC_MATRIX } from './dependencyModel';

interface Escalation {
  id: string;
  clientId?: string;
  client: string;
  days: number;
}

const INITIAL_ESCALATIONS: Escalation[] = [
  { id: 'e-abc', clientId: 'c-abc', client: 'ABC Pvt Ltd', days: 21 },
  { id: 'e-rst', clientId: 'c-rst', client: 'RST Pvt Ltd', days: 16 },
  { id: 'e-delta', client: 'Delta Motors', days: 13 },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
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

/** Right rail: reminder autopilot, escalation queue, response-time insight. */
export default function RightRail() {
  const { notify, sendReminder } = useDemoStore();
  const [autopilot, setAutopilot] = useState(true);
  const [escalations, setEscalations] = useState(INITIAL_ESCALATIONS);

  const resolve = (id: string, action: string) => {
    const item = escalations.find((e) => e.id === id);
    if (!item) return;
    if (action === 'call') notify(`Marked as called — ${item.client}`, 'success');
    setEscalations((list) => list.filter((e) => e.id !== id));
  };

  const maxMedian = Math.max(...DOC_MATRIX.map((d) => d.medianDays));

  return (
    <div className="space-y-5">
      {/* Reminder autopilot */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="rounded-xl border border-line bg-card p-5 shadow-card"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Bot className="h-4 w-4 text-brand" /> Reminder autopilot
          </h2>
          <Toggle on={autopilot} onChange={setAutopilot} label="Toggle reminder autopilot" />
        </div>
        <p className="mt-2 text-[12px] leading-[18px] text-ink-3">
          Auto-reminders every 3 days, escalating to manager after 3 attempts.
        </p>
        <div className="mt-3 rounded-lg bg-paper-deep/60 px-3 py-2 font-mono text-[11px] text-ink-2">
          Today 09:00 — 12 reminders sent
        </div>
      </motion.section>

      {/* Escalations */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: 'easeOut' }}
        className="rounded-xl border border-line bg-card p-5 shadow-card"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold text-ink">Escalations</h2>
          <span className="text-[11px] font-medium text-ink-3 tnum">{escalations.length} awaiting partner call</span>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">After 3 unanswered reminders</p>
        <ul className="mt-3 space-y-2">
          <AnimatePresence initial={false}>
            {escalations.map((e) => (
              <motion.li
                key={e.id}
                layout="position"
                exit={{ opacity: 0, x: 24, height: 0, marginTop: 0, marginBottom: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="overflow-hidden rounded-lg border border-line bg-paper-deep/40 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-ink">{e.client}</div>
                    <div className="text-[11px] text-ink-3">
                      waiting <span className="font-semibold text-critical tnum">{e.days}d</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => resolve(e.id, 'call')}
                      className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-brand-deep"
                    >
                      <Phone className="h-3 w-3" /> Call
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (e.clientId) sendReminder(e.clientId, 'WhatsApp');
                        else notify(`WhatsApp nudge sent — ${e.client}`, 'success');
                        resolve(e.id, 'whatsapp');
                      }}
                      aria-label={`WhatsApp ${e.client}`}
                      className="rounded-md border border-line bg-card p-1.5 text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
          {escalations.length === 0 && (
            <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-3">
              All escalations handled. Nice work.
            </li>
          )}
        </ul>
      </motion.section>

      {/* Response-time insight */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.16, ease: 'easeOut' }}
        className="rounded-xl border border-line bg-card p-5 shadow-card"
      >
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <TrendingUp className="h-4 w-4 text-gold" /> Response-time insight
        </h2>
        <p className="mt-2 text-[12px] leading-[18px] text-ink-2">
          Clients reply slowest to <span className="font-semibold text-ink">bank-statement requests</span> (median{' '}
          <span className="tnum">5.1 days</span>).
        </p>
        <div className="mt-3 space-y-2.5">
          {DOC_MATRIX.map((d, i) => (
            <div key={d.id}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-ink-2">{d.label}</span>
                <span className="font-mono text-ink-3 tnum">{d.medianDays.toFixed(1)}d</span>
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.06 }}
              >
                <Meter value={d.medianDays} max={maxMedian} tone={d.medianDays >= 5 ? 'amber' : 'brand'} className="mt-1 h-1" />
              </motion.div>
            </div>
          ))}
        </div>
      </motion.section>
    </div>
  );
}
