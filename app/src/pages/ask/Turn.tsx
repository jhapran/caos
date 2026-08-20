import { memo } from 'react';
import { motion } from 'framer-motion';
import { Download, Sparkles } from 'lucide-react';
import { AnswerCard } from '@/components/AskCAOS';
import RiskGauge from '@/components/RiskGauge';
import type { AskAnswer, AskTable } from '@/data';
import type { ConversationTurn } from './types';

/** Download the answer table as a real CSV file. */
function exportCsv(table: AskTable) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = [table.columns, ...table.rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'caos-answer.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Three pulsing violet dots shown while CAOS "thinks". */
function Thinking() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-violet/20 bg-violet-soft/60 px-4 py-3">
      <Sparkles className="h-4 w-4 text-violet" strokeWidth={1.8} />
      <div className="flex items-center gap-1.5" aria-label="CAOS is thinking">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-violet"
            animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.1, 0.85] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
      <span className="text-[12px] font-medium text-violet">Reading the firm's compliance graph…</span>
    </div>
  );
}

/** Capacity bar for the team-load answer supplement. */
function CapacityBar({ name, pct, tone }: { name: string; pct: number; tone: 'amber' | 'brand' }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-[12px] font-medium text-ink-2">{name}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-deep">
        <motion.div
          className={tone === 'amber' ? 'h-full rounded-full bg-warning' : 'h-full rounded-full bg-brand'}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11px] text-ink-3 tnum">{pct}%</span>
    </div>
  );
}

/**
 * Supplemental structured renderer below the shared AnswerCard — keyed to the
 * fixture being answered (risk gauge for the risk question, capacity board for
 * the team-load question). The shared card already renders the table.
 */
function Supplement({ answer }: { answer: AskAnswer }) {
  if (answer.question.startsWith('What is ABC Pvt Ltd')) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25 }}
        className="flex items-center gap-6 rounded-xl border border-line bg-card p-5 shadow-card"
      >
        <RiskGauge score={82} size={150} label="ABC Pvt Ltd" />
        <div className="space-y-1.5 text-[12.5px] leading-5">
          <p className="font-mono text-[11px] tracking-[0.08em] text-ink-3 uppercase">Score arithmetic</p>
          <p className="text-ink-2">
            <span className="font-mono text-ink">40</span> work not started · <span className="font-mono text-ink">+28</span> overdue items ·{' '}
            <span className="font-mono text-ink">+12</span> documents missing
          </p>
          <p className="text-ink-2">
            = <span className="font-mono font-semibold text-critical">82 / 100</span> — firm threshold for "critical" is 70.
          </p>
        </div>
      </motion.div>
    );
  }
  if (answer.question.startsWith('How is the team loaded')) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25 }}
        className="space-y-2.5 rounded-xl border border-line bg-card p-5 shadow-card"
      >
        <p className="font-mono text-[11px] tracking-[0.08em] text-ink-3 uppercase">Capacity · Sep 2025</p>
        <CapacityBar name="Priya Nair" pct={92} tone="amber" />
        <CapacityBar name="Rahul Verma" pct={84} tone="amber" />
        <CapacityBar name="Neha Iyer" pct={63} tone="brand" />
        <CapacityBar name="Amit Shah" pct={58} tone="brand" />
        <CapacityBar name="CA Lew Kong" pct={35} tone="brand" />
      </motion.div>
    );
  }
  return null;
}

const SOURCE_LINES: [match: string, source: string][] = [
  ['GSTR-3B', 'Source: 240 GST registrations · risk model v2.3 · computed just now'],
  ['blocking', 'Source: 48 dependent clients · 79 blocked tasks · computed just now'],
  ['risk score', 'Source: risk model v2.3 · factor weights FY 2024-25 · computed just now'],
  ['file today', 'Source: 9 ready-to-file returns · approvals ledger · computed just now'],
  ['risk alerts', 'Source: 5 active alerts · alert engine v1.8 · computed just now'],
  ['team loaded', 'Source: 1,284 active tasks · capacity planner · computed just now'],
];

function sourceLine(answer: AskAnswer): string {
  const hit = SOURCE_LINES.find(([m]) => answer.question.includes(m));
  return hit ? hit[1] : 'Source: firm compliance graph · best-effort interpretation · computed just now';
}

/** A single conversation turn: user bubble → (thinking) → AnswerCard + extras. */
function Turn({ turn, onFollowUp }: { turn: ConversationTurn; onFollowUp: (q: string) => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
      className="space-y-3"
    >
      {/* User bubble — right-aligned, brand-deep */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[14px] rounded-br-md bg-brand-deep px-4 py-2.5 text-[14px] leading-6 text-paper shadow-card">
          {turn.query}
        </div>
      </div>

      {!turn.answer ? (
        <Thinking />
      ) : (
        <>
          {turn.isFallback && (
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-violet">
              <Sparkles className="h-3.5 w-3.5" />
              Best-effort interpretation — here's the closest matching cut.
            </p>
          )}
          <AnswerCard answer={turn.answer} onFollowUp={onFollowUp} />
          <Supplement answer={turn.answer} />
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[11px] leading-4 text-ink-3">{sourceLine(turn.answer)}</p>
            {turn.answer.table && (
              <button
                type="button"
                onClick={() => exportCsv(turn.answer!.table!)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            )}
          </div>
        </>
      )}
    </motion.section>
  );
}

export default memo(Turn);
