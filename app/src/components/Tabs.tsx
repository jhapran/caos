import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

/** Tabs — underline style, gold active indicator. */
export default function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex items-center gap-5 border-b border-line', className)}>
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative -mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-[13px] font-medium transition-colors',
              isActive ? 'border-gold text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[11px] font-semibold tnum',
                  isActive ? 'bg-gold-soft text-gold' : 'bg-paper-deep text-ink-3',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** SegmentedControl — pill-style toggle for 2–4 mutually exclusive options. */
export function SegmentedControl({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-lg bg-paper-deep p-0.5', className)} role="group">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12px] font-medium transition-all',
              isActive ? 'bg-card text-ink shadow-card' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
