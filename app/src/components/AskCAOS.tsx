import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { AskAnswer } from '@/data/types';
import { prefersReducedMotion } from './CountUp';
import { cn } from '@/lib/utils';

/** AskCAOSBar — violet-accented natural-language input with sparkle icon. */
export function AskCAOSBar({
  onAsk,
  placeholder = 'Ask about clients, deadlines, risk…',
  loading = false,
  autoFocus = false,
  large = false,
}: {
  onAsk: (query: string) => void;
  placeholder?: string;
  loading?: boolean;
  autoFocus?: boolean;
  large?: boolean;
}) {
  const [value, setValue] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !loading) {
      onAsk(value.trim());
      setValue('');
    }
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-violet/25 bg-card shadow-card transition-shadow focus-within:border-violet/50 focus-within:shadow-lift',
        large ? 'px-5 py-4' : 'px-4 py-3',
      )}
    >
      <Sparkles className={cn('shrink-0 text-violet', large ? 'h-5 w-5' : 'h-4 w-4')} strokeWidth={1.8} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={loading}
        className={cn(
          'flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3',
          large ? 'text-[15px]' : 'text-[13px]',
        )}
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className="flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-violet/85 disabled:opacity-40"
      >
        {loading ? 'Thinking…' : 'Ask'}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

/** Streams text like a typewriter (14ms/char); respects prefers-reduced-motion. */
export function useTypewriter(text: string, active = true): string {
  const [shown, setShown] = useState(() => (prefersReducedMotion() || !active ? text : ''));
  const iRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion() || !active) {
      setShown(text);
      return;
    }
    setShown('');
    iRef.current = 0;
    const id = window.setInterval(() => {
      iRef.current += 1;
      setShown(text.slice(0, iRef.current));
      if (iRef.current >= text.length) window.clearInterval(id);
    }, 14);
    return () => window.clearInterval(id);
  }, [text, active]);

  return shown;
}

/** AnswerCard — streamed summary + "How CAOS answered" chip tray + result table + follow-ups. */
export function AnswerCard({
  answer,
  onFollowUp,
  animate = true,
  className,
}: {
  answer: AskAnswer;
  onFollowUp?: (q: string) => void;
  animate?: boolean;
  className?: string;
}) {
  const summary = useTypewriter(answer.summary, animate);
  const summaryDone = !animate || summary.length >= answer.summary.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn('overflow-hidden rounded-xl border border-line bg-card shadow-card', className)}
    >
      {/* How CAOS answered — chip tray on dark reasoning panel */}
      <div className="relative bg-brand-deep px-5 py-3.5">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ backgroundImage: 'url(/pattern-ledger.svg)', backgroundSize: '200px' }}
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.14em] text-paper/50 uppercase">How CAOS answered</span>
          {answer.chips.map((chip) => (
            <span key={chip.label} className="rounded-full border border-paper/20 bg-paper/10 px-2.5 py-0.5 text-[11px] text-paper/85">
              <span className="text-paper/50">{chip.label}:</span> {chip.value}
            </span>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="min-h-[42px] text-[14px] leading-6 text-ink">
          {summary}
          {!summaryDone && <span className="ml-0.5 inline-block h-4 w-[2px] animate-caret-blink bg-violet align-text-bottom" />}
        </p>

        {answer.table && summaryDone && (
          <div className="mt-4 overflow-hidden rounded-lg border border-line">
            <table className="w-full text-[12.5px] leading-5">
              <thead>
                <tr className="bg-paper-deep/70">
                  {answer.table.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left text-caption">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {answer.table.rows.map((row, i) => (
                  <motion.tr
                    key={i}
                    initial={animate ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i, duration: 0.25 }}
                    className="border-t border-line/60"
                  >
                    {row.map((cell, j) => (
                      <td key={j} className={cn('px-3 py-2', j === 0 ? 'font-medium text-ink' : 'text-ink-2')}>
                        {cell}
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summaryDone && answer.followUps.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {answer.followUps.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp?.(q)}
                className="rounded-full border border-violet/25 bg-violet-soft px-3 py-1 text-[12px] font-medium text-violet transition-colors hover:border-violet/50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
