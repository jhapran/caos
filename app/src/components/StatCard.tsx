import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import CountUp from './CountUp';
import { cn } from '@/lib/utils';

/** StatCard — label, count-up value, delta/context line, icon chip, optional sparkline, optional click-through. */
export default function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = 'ink',
  sparkline,
  onClick,
  className,
}: {
  label: string;
  value: number;
  delta?: string;
  icon?: LucideIcon;
  tone?: 'ink' | 'brand' | 'success' | 'warning' | 'critical' | 'info' | 'violet';
  sparkline?: number[];
  onClick?: () => void;
  className?: string;
}) {
  const toneText: Record<string, string> = {
    ink: 'text-ink',
    brand: 'text-brand',
    success: 'text-success',
    warning: 'text-warning-strong',
    critical: 'text-critical',
    info: 'text-info',
    violet: 'text-violet',
  };
  const toneChip: Record<string, string> = {
    ink: 'bg-paper-deep text-ink-2',
    brand: 'bg-brand-soft text-brand',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning-strong',
    critical: 'bg-critical-soft text-critical',
    info: 'bg-info-soft text-info',
    violet: 'bg-violet-soft text-violet',
  };

  const body: ReactNode = (
    <>
      <div className="flex items-start justify-between">
        <span className="text-caption">{label}</span>
        {Icon && (
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', toneChip[tone])}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
        )}
      </div>
      <div className={cn('mt-2 text-stat-xl', toneText[tone])}>
        <CountUp value={value} />
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        {delta && <span className="text-[12px] leading-4 text-ink-3">{delta}</span>}
        {sparkline && sparkline.length > 1 && (
          <svg viewBox="0 0 64 20" className="h-5 w-16 shrink-0" aria-hidden>
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className={toneText[tone]}
              points={sparkline
                .map((v, i) => {
                  const min = Math.min(...sparkline);
                  const max = Math.max(...sparkline);
                  const range = max - min || 1;
                  const x = (i / (sparkline.length - 1)) * 64;
                  const y = 18 - ((v - min) / range) * 16;
                  return `${x.toFixed(1)},${y.toFixed(1)}`;
                })
                .join(' ')}
            />
          </svg>
        )}
      </div>
    </>
  );

  const cls = cn(
    'rounded-xl border border-line bg-card p-5 text-left shadow-card transition-all duration-200',
    onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-lift',
    className,
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'w-full')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
