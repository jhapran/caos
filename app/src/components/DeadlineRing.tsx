import { cn } from '@/lib/utils';

/**
 * DeadlineRing — small circular days-left ring (SVG stroke-dashoffset) for deadline rows.
 * Color follows urgency: >14d brand, 8–14 warning, ≤7 critical.
 */
export default function DeadlineRing({
  daysLeft,
  size = 40,
  window: totalWindow = 30,
  className,
}: {
  daysLeft: number;
  size?: number;
  /** total days that represent a full ring */
  window?: number;
  className?: string;
}) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const overdue = daysLeft < 0;
  const fraction = overdue ? 1 : Math.max(0.04, Math.min(1, daysLeft / totalWindow));
  const color = overdue || daysLeft <= 7 ? '#C0362C' : daysLeft <= 14 ? '#C77414' : '#0E5F52';
  const label = overdue ? `${Math.abs(daysLeft)}d!` : `${daysLeft}d`;

  return (
    <span className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }} title={overdue ? `Overdue by ${-daysLeft} days` : `${daysLeft} days left`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EFECE5" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-medium tnum" style={{ color }}>
        {label}
      </span>
    </span>
  );
}
