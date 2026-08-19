import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Thin horizontal meter that fills once on mount (0.7s). Shared by dependency / alerts / reports pages. */
export default function Meter({
  value,
  max,
  tone = 'amber',
  className,
}: {
  value: number;
  max: number;
  tone?: 'amber' | 'brand' | 'critical' | 'success' | 'info';
  className?: string;
}) {
  const tones: Record<string, string> = {
    amber: 'bg-warning',
    brand: 'bg-brand',
    critical: 'bg-critical',
    success: 'bg-success',
    info: 'bg-info',
  };
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-paper-deep', className)} aria-hidden>
      <motion.div
        className={cn('h-full rounded-full', tones[tone])}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
    </div>
  );
}
