import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import CountUp from '@/components/CountUp';
import { FIRM } from '@/data';
import { DEMO_TODAY } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/**
 * Today's posture — PRD §137 narrative numbers. "Critical" tracks the live
 * active-alert count (5 at seed); at-risk / on-track are the PRD posture split.
 */
const POSTURE = [
  { key: 'critical', label: 'Critical', value: 5, dot: 'bg-critical', chip: 'bg-critical-soft text-critical' },
  { key: 'at-risk', label: 'At Risk', value: 12, dot: 'bg-warning', chip: 'bg-warning-soft text-warning-strong' },
  { key: 'on-track', label: 'On Track', value: 684, dot: 'bg-success', chip: 'bg-success-soft text-success' },
];

const GREETING_WORDS = ['Good', 'Morning,', 'CA Lew Kong.'];

/** Section 1 — greeting band: editorial greeting + attention count + posture chips. */
export default function GreetingBand() {
  const navigate = useNavigate();

  return (
    <section aria-label="Morning greeting" className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div>
          <h1 className="text-display text-ink" aria-label="Good Morning, CA Lew Kong.">
          {GREETING_WORDS.map((word, i) => (
            <motion.span
              key={word}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
              className="inline-block"
            >
              {word}
              {i < GREETING_WORDS.length - 1 ? ' ' : ''}
            </motion.span>
          ))}
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
          className="mt-2 flex items-baseline gap-2 text-[15px] leading-6 text-ink-2"
        >
          <motion.span
            initial={{ color: '#B7791F' }}
            animate={{ color: '#101828' }}
            transition={{ duration: 1.2, delay: 0.9, ease: 'easeOut' }}
            className="text-stat-xl underline decoration-gold decoration-[3px] underline-offset-6"
          >
            <CountUp value={17} duration={0.8} />
          </motion.span>
          <span>items need attention today.</span>
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-1.5 text-caption normal-case"
        >
          {format(DEMO_TODAY, 'EEEE, dd MMMM yyyy')} · {FIRM.fy} · {FIRM.shortName}
        </motion.p>
      </div>

      {/* Today's posture */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Today's posture">
        {POSTURE.map((p, i) => (
          <motion.button
            key={p.key}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 + i * 0.1, ease: EASE }}
            onClick={() => navigate(`/command?posture=${p.key}`)}
            className={cn(
              'flex items-center gap-2 rounded-full px-3.5 py-2 transition-all hover:-translate-y-px hover:shadow-card',
              p.chip,
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', p.dot)} />
            <span className="font-mono text-[15px] leading-5 font-semibold tnum">
              <CountUp value={p.value} duration={0.8} />
            </span>
            <span className="text-[12px] leading-4 font-medium">{p.label}</span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
