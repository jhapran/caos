import { motion } from 'framer-motion';
import { prefersReducedMotion, useCountUp } from './CountUp';
import { cn } from '@/lib/utils';

function scoreColor(score: number): string {
  if (score < 40) return '#157A4E'; // success
  if (score < 70) return '#C77414'; // warning
  return '#C0362C'; // critical
}

/**
 * RiskGauge — arc sweeping 0→score (Framer Motion pathLength, 0.9s easeOut),
 * color success→warning→critical, numeric count-up in mono.
 * Used in Compliance Detail and Ask CAOS answer cards.
 */
export default function RiskGauge({
  score,
  size = 160,
  className,
  label = 'Risk score',
}: {
  score: number;
  size?: number;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const reduced = prefersReducedMotion();
  const shown = useCountUp(clamped, 0.9);

  // Arc with a 120° opening at the bottom (240° sweep), centred in the viewBox.
  const r = 44;
  const cx = 50;
  const cy = 54;
  const startAngle = 150;
  const sweepTotal = 240;
  const rad = (a: number) => (a * Math.PI) / 180;
  const sx = cx + r * Math.cos(rad(startAngle));
  const sy = cy + r * Math.sin(rad(startAngle));
  const ex = cx + r * Math.cos(rad(startAngle + sweepTotal));
  const ey = cy + r * Math.sin(rad(startAngle + sweepTotal));
  const d = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;

  const color = scoreColor(clamped);

  return (
    <div className={cn('inline-flex flex-col items-center', className)} style={{ width: size }}>
      <svg
        viewBox="0 0 100 80"
        width={size}
        height={(size * 80) / 100}
        role="img"
        aria-label={`${label}: ${clamped} of 100`}
      >
        <path d={d} fill="none" stroke="#EFECE5" strokeWidth="9" strokeLinecap="round" />
        <motion.path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          initial={{ pathLength: reduced ? clamped / 100 : 0 }}
          animate={{ pathLength: clamped / 100 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <text
          x="50"
          y="56"
          textAnchor="middle"
          style={{ fontSize: 21, fontFamily: "'IBM Plex Mono', monospace", fontVariantNumeric: 'tabular-nums', fill: '#101828', fontWeight: 500 }}
        >
          {shown}
        </text>
        <text x="50" y="70" textAnchor="middle" style={{ fontSize: 7.5, fill: '#98A2B3', fontFamily: 'Inter, sans-serif', letterSpacing: '0.08em' }}>
          {label.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}
