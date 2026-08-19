import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Badge — small count/label chip used on nav items and headers. */
export default function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'brand' | 'critical' | 'warning' | 'violet';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-paper-deep text-ink-2',
    gold: 'bg-gold text-white',
    brand: 'bg-brand-soft text-brand',
    critical: 'bg-critical-soft text-critical',
    warning: 'bg-warning-soft text-warning-strong',
    violet: 'bg-violet-soft text-violet',
  };
  return (
    <span
      className={cn(
        'inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-4 font-semibold tnum',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
