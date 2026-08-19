import { memo } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { SUGGESTED_QUESTIONS } from '@/data';

/** Slowly rotating violet sparkle — isolated so the parent never resets it. */
const OrbitSparkle = memo(function OrbitSparkle() {
  return (
    <motion.span
      className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-soft"
      animate={{ rotate: 360 }}
      transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
    >
      <Sparkles className="h-7 w-7 text-violet" strokeWidth={1.6} />
    </motion.span>
  );
});

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
};

/** Empty state: hero + suggested-question chips (violet = AI surface). */
export default function EmptyHero({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl px-4 py-16 text-center"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'url(/pattern-ledger.svg)', backgroundSize: '400px' }}
        aria-hidden
      />

      <motion.div variants={item}>
        <OrbitSparkle />
      </motion.div>

      <motion.h1 variants={item} className="mt-6 font-display text-[28px] leading-9 font-medium italic tracking-[-0.01em] text-ink">
        Ask anything about your firm.
      </motion.h1>
      <motion.p variants={item} className="mt-2 max-w-md text-[13px] leading-5 text-ink-3">
        CAOS reads every client, deadline, document and risk — and answers with data.
      </motion.p>

      <motion.div variants={item} className="mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="rounded-full border border-violet/25 bg-violet-soft px-3.5 py-1.5 font-mono text-[12px] text-violet transition-all hover:-translate-y-0.5 hover:border-violet/60 hover:shadow-lift"
          >
            {q}
          </button>
        ))}
      </motion.div>
    </motion.div>
  );
}
