import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { SUGGESTED_QUESTIONS } from '@/data';
import useCyclingPlaceholder from '../command/useCyclingPlaceholder';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/**
 * Section 4 — Ask CAOS bar. Full-width violet input, cycling typewriter
 * placeholder, ⌘K hint chip, gold focus ring. Enter routes to /ask?q=…
 */
export default function AskBar() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const questions = useMemo(() => SUGGESTED_QUESTIONS.slice(0, 4), []);
  const placeholder = useCyclingPlaceholder(questions);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    navigate(q ? `/ask?q=${encodeURIComponent(q)}` : '/ask');
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
      aria-label="Ask CAOS"
      className="flex items-center gap-3 rounded-xl border border-violet/25 bg-card px-4 py-3.5 shadow-card transition-all focus-within:border-gold/50 focus-within:ring-2 focus-within:ring-gold/30"
    >
      <Sparkles className="h-5 w-5 shrink-0 text-violet" strokeWidth={1.8} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder || 'Ask anything — deadlines, clients, risk…'}
        aria-label="Ask CAOS anything"
        className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
      />
      <kbd className="hidden shrink-0 items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 font-mono text-[10.5px] text-ink-3 sm:flex">
        ⌘K
      </kbd>
    </motion.form>
  );
}
