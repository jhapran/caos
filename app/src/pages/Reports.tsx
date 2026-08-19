import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, FileDown, Link2 } from 'lucide-react';
import { SegmentedControl } from '@/components/Tabs';
import { useDemoStore } from '@/data';
import { cn } from '@/lib/utils';
import ReportSheet from './reports/ReportSheet';

/** Print stylesheet — hides the app shell, expands the sheet, keeps brand accents. */
const PRINT_CSS = `
@media print {
  body { background: #ffffff !important; }
  header, aside, .reports-no-print { display: none !important; }
  .md\\:pl-16, .xl\\:pl-60 { padding-left: 0 !important; }
  .reports-sheet {
    max-width: none !important;
    width: 100% !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
  }
  .reports-sheet * {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
    animation: none !important;
  }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

function ScheduleToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
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

/** Reports — board-ready compliance & deadline snapshot (print / share friendly). */
export default function Reports() {
  const { notify } = useDemoStore();
  const [mode, setMode] = useState<'status' | 'deadlines'>('status');
  const [scheduled, setScheduled] = useState({ monday: true, monthEnd: true });

  const exportPdf = () => {
    notify('Opening print dialog — choose “Save as PDF”', 'info');
    window.setTimeout(() => window.print(), 350);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* clipboard unavailable in some demo iframes — toast either way */
    }
    notify('Demo link copied', 'success');
  };

  return (
    <div>
      <style>{PRINT_CSS}</style>

      {/* Section 1 — Header + actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="reports-no-print flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">Reports</h1>
          <p className="mt-1 text-[14px] text-ink-2">
            Auto-generated from live Command Centre data · 09 Sep 2025
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <SegmentedControl
              items={[
                { id: 'status', label: 'Compliance status' },
                { id: 'deadlines', label: 'Upcoming deadlines' },
              ]}
              active={mode}
              onChange={(id) => setMode(id as 'status' | 'deadlines')}
            />
          </motion.div>
          <motion.button
            type="button"
            onClick={exportPdf}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"
          >
            <FileDown className="h-4 w-4" /> Export PDF
          </motion.button>
          <motion.button
            type="button"
            onClick={copyLink}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
          >
            <Link2 className="h-4 w-4" /> Copy share link
          </motion.button>
        </div>
      </motion.div>

      {/* Section 2 — Report sheet */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
        className="mt-6"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ReportSheet mode={mode} />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Section 3 — Scheduled reports */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="reports-no-print mx-auto mt-6 w-full max-w-[880px] rounded-xl border border-line bg-card p-5 shadow-card"
      >
        <h2 className="flex items-center gap-2 text-[17px] leading-6 font-semibold text-ink">
          <CalendarClock className="h-4 w-4 text-brand" /> Scheduled
        </h2>
        <div className="mt-3 divide-y divide-line/60">
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-ink">Monday Morning Brief</div>
              <div className="mt-0.5 text-[12px] text-ink-3">Every Mon 8:30 AM to partners</div>
            </div>
            <ScheduleToggle
              on={scheduled.monday}
              onChange={(v) => {
                setScheduled((s) => ({ ...s, monday: v }));
                notify(v ? 'Monday Morning Brief scheduled' : 'Monday Morning Brief paused', 'info');
              }}
              label="Monday Morning Brief schedule"
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-ink">Month-end compliance pack</div>
              <div className="mt-0.5 text-[12px] text-ink-3">1st of month · full ledger + exceptions</div>
            </div>
            <ScheduleToggle
              on={scheduled.monthEnd}
              onChange={(v) => {
                setScheduled((s) => ({ ...s, monthEnd: v }));
                notify(v ? 'Month-end pack scheduled' : 'Month-end pack paused', 'info');
              }}
              label="Month-end compliance pack schedule"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">Delivered to email &amp; WhatsApp.</p>
      </motion.section>
    </div>
  );
}
