// Risk score breakdown — RiskGauge + itemized arithmetic factor list.
// Factor meters fill sequentially as the gauge sweeps; live re-scores re-animate.
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { CalendarClock, Eye, FileCheck, FileX, Gauge, User } from 'lucide-react';
import RiskGauge from '@/components/RiskGauge';
import { cn } from '@/lib/utils';

export interface DisplayFactor {
  key: string;
  label: string;
  detail: string;
  points: number;
  /** set when a live re-score changed this factor — renders the strike-through */
  originalPoints?: number;
}

function factorIcon(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (l.includes('document') || l.includes('information') || l.includes('awaiting')) return FileX;
  if (l.includes('due') || l.includes('overdue') || l.includes('proximity') || l.includes('remaining')) return CalendarClock;
  if (l.includes('owner') || l.includes('workload') || l.includes('respond')) return User;
  if (l.includes('review')) return Eye;
  if (l.includes('filed')) return FileCheck;
  return Gauge;
}

function chipClass(points: number): string {
  if (points >= 25) return 'bg-critical-soft text-critical';
  if (points >= 10) return 'bg-warning-soft text-warning-strong';
  return 'bg-paper-deep text-ink-2';
}

export default function RiskBreakdown({
  score,
  factors,
}: {
  score: number;
  factors: DisplayFactor[];
}) {
  const maxPoints = Math.max(1, ...factors.map((f) => Math.max(f.points, f.originalPoints ?? 0)));
  const total = factors.reduce((s, f) => s + f.points, 0);

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex shrink-0 flex-col items-center justify-center md:w-44">
        <RiskGauge score={score} size={168} />
        <span
          className={cn(
            'mt-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            score >= 70
              ? 'bg-critical-soft text-critical'
              : score >= 40
                ? 'bg-warning-soft text-warning-strong'
                : 'bg-success-soft text-success',
          )}
        >
          {score >= 70 ? 'Critical zone' : score >= 40 ? 'Watch zone' : 'Healthy zone'}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-caption">Score composition</div>
        <ul className="mt-2 divide-y divide-line/70">
          {factors.map((f, i) => {
            const changed = typeof f.originalPoints === 'number' && f.originalPoints !== f.points;
            const Icon = factorIcon(f.label);
            return (
              <motion.li
                key={f.key}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut', delay: 0.3 + i * 0.15 }}
                className="flex items-center gap-3 py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paper-deep text-ink-2">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{f.label}</span>
                  <span className="block truncate text-[11px] text-ink-3">{f.detail}</span>
                  <span className="mt-1.5 block h-1 w-full max-w-44 overflow-hidden rounded-full bg-paper-deep">
                    <motion.span
                      className={cn('block h-full rounded-full', f.points >= 25 ? 'bg-critical' : f.points >= 10 ? 'bg-warning' : 'bg-ink-3/60')}
                      initial={false}
                      animate={{ width: `${(f.points / maxPoints) * 100}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 + i * 0.15 }}
                    />
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {changed && (
                    <motion.span
                      initial={{ opacity: 0.4 }}
                      animate={{ opacity: 1 }}
                      className="font-mono text-[11px] text-ink-3 line-through tnum"
                    >
                      +{f.originalPoints}
                    </motion.span>
                  )}
                  <motion.span
                    layout="position"
                    className={cn('rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tnum', chipClass(f.points))}
                  >
                    +{f.points}
                  </motion.span>
                </span>
              </motion.li>
            );
          })}
          {/* total row — gold top hairline */}
          <li className="flex items-center justify-between border-t-2 border-gold/70 py-2.5">
            <span className="text-[13px] font-semibold text-ink">Total risk score</span>
            <span className="font-mono text-[14px] font-semibold text-ink tnum">= {total} / 100</span>
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-ink-3">
          Scores ≥ 70 are critical. Model: rules v2.3 · updated today 06:00.
        </p>
      </div>
    </div>
  );
}
