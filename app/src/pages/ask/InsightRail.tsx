import { motion } from 'framer-motion';
import { BarChart3, ListChecks, Sparkles, Timer } from 'lucide-react';
import { ASK_FIXTURES } from '@/data';

/** Right insight rail (xl+): query shortcuts + playful demo stats. */
export default function InsightRail({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="sticky top-[84px] hidden w-[300px] shrink-0 space-y-4 self-start xl:block"
    >
      <div className="rounded-xl border border-line bg-card p-4 shadow-card">
        <p className="flex items-center gap-1.5 text-caption">
          <Sparkles className="h-3.5 w-3.5 text-violet" />
          Query shortcuts
        </p>
        <ul className="mt-3 space-y-1">
          {ASK_FIXTURES.map((f) => (
            <li key={f.question}>
              <button
                type="button"
                onClick={() => onAsk(f.question)}
                className="w-full truncate rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-violet-soft hover:text-violet"
                title={f.question}
              >
                {f.question}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-line bg-card p-4 shadow-card">
        <p className="text-caption">This week</p>
        <ul className="mt-3 space-y-3">
          <li className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-soft text-violet">
              <ListChecks className="h-4 w-4" />
            </span>
            <div>
              <p className="font-mono text-[14px] font-medium text-ink tnum">42</p>
              <p className="text-[11px] text-ink-3">queries asked</p>
            </div>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div>
              <p className="font-mono text-[14px] font-medium text-ink">GST</p>
              <p className="text-[11px] text-ink-3">top topic</p>
            </div>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-soft text-gold">
              <Timer className="h-4 w-4" />
            </span>
            <div>
              <p className="font-mono text-[14px] font-medium text-ink tnum">1.2s</p>
              <p className="text-[11px] text-ink-3">avg answer time</p>
            </div>
          </li>
        </ul>
      </div>
    </motion.aside>
  );
}
