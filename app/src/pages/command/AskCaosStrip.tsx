import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { AskCAOSBar } from '@/components/AskCAOS';
import { SUGGESTED_QUESTIONS } from '@/data';
import useCyclingPlaceholder from './useCyclingPlaceholder';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const CHIPS = [
  'Which GST clients are at risk this month?',
  'Show all tasks assigned to Rahul',
  "Who hasn't submitted bank statements?",
];

/**
 * Section F — Ask CAOS strip. Violet-tinted entry point to the conversational
 * interface; placeholder cycles seeded questions, Enter/chip routes to /ask.
 */
export default function AskCaosStrip({ delay = 0 }: { delay?: number }) {
  const navigate = useNavigate();
  const questions = useMemo(() => SUGGESTED_QUESTIONS.slice(0, 5), []);
  const placeholder = useCyclingPlaceholder(questions);

  const ask = (q: string) => navigate(`/ask?q=${encodeURIComponent(q)}`);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Ask CAOS"
      className="rounded-xl border border-violet/25 bg-violet-soft/40 p-6 shadow-card transition-colors focus-within:border-violet/50"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet text-white">
          <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
        <div>
          <span className="font-display text-[20px] leading-6 text-ink italic">Ask CAOS</span>
          <span className="block text-[12px] leading-4 text-ink-3">Answers from your live compliance graph — a table, not a paragraph.</span>
        </div>
      </div>

      <div className="mt-4">
        <AskCAOSBar onAsk={ask} placeholder={placeholder} large />
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {CHIPS.map((chip, i) => (
          <motion.button
            key={chip}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: delay + 0.25 + i * 0.08, ease: EASE }}
            onClick={() => ask(chip)}
            className="rounded-full border border-violet/25 bg-card px-3 py-1.5 text-[12px] font-medium text-violet transition-all hover:-translate-y-px hover:border-violet/50 hover:shadow-card"
          >
            {chip}
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}
