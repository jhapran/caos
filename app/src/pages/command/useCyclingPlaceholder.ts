import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/components/CountUp';

/**
 * Typewriter-cycling placeholder: types each question, holds, deletes, advances.
 * Respects prefers-reduced-motion (renders the first question statically).
 */
export default function useCyclingPlaceholder(questions: string[], typeMs = 26, holdMs = 3000): string {
  const [text, setText] = useState(() => (prefersReducedMotion() ? (questions[0] ?? '') : ''));

  useEffect(() => {
    if (questions.length === 0 || prefersReducedMotion()) return;
    let q = 0;
    let c = 0;
    let timer = 0;
    let phase: 'typing' | 'holding' | 'deleting' = 'typing';

    const tick = () => {
      const full = questions[q];
      if (phase === 'typing') {
        c += 1;
        setText(full.slice(0, c));
        if (c >= full.length) {
          phase = 'holding';
          timer = window.setTimeout(tick, holdMs);
        } else {
          timer = window.setTimeout(tick, typeMs);
        }
      } else if (phase === 'holding') {
        phase = 'deleting';
        timer = window.setTimeout(tick, 16);
      } else {
        c -= 1;
        setText(full.slice(0, c));
        if (c <= 0) {
          q = (q + 1) % questions.length;
          phase = 'typing';
          timer = window.setTimeout(tick, 400);
        } else {
          timer = window.setTimeout(tick, 12);
        }
      }
    };

    timer = window.setTimeout(tick, 600);
    return () => window.clearTimeout(timer);
  }, [questions, typeMs, holdMs]);

  return text;
}
