import { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { prefersReducedMotion } from '@/components/CountUp';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const QUESTIONS = [
  { q: 'What is due?', chips: [
    { label: '17 items need attention', tone: 'brand' },
    { label: 'GSTR-3B · 20 Sep', tone: 'neutral' },
    { label: 'Adv Tax · 15 Sep', tone: 'warning' },
  ]},
  { q: 'What is missing?', chips: [
    { label: '48 clients blocking 79 tasks', tone: 'warning' },
    { label: 'ABC Pvt Ltd · 7 tasks', tone: 'critical' },
    { label: '2 reminders sent', tone: 'neutral' },
  ]},
  { q: 'Who is responsible?', chips: [
    { label: 'Priya Nair · 312 tasks', tone: 'neutral' },
    { label: 'Rahul Verma · 288 tasks', tone: 'neutral' },
    { label: 'Amit Shah · headroom', tone: 'success' },
  ]},
  { q: 'What needs attention?', chips: [
    { label: '5 critical alerts', tone: 'critical' },
    { label: '16 at-risk compliances', tone: 'warning' },
    { label: '21 items in review', tone: 'brand' },
  ]},
] as const;

const TONE_STYLES: Record<string, string> = {
  brand: 'border-brand/40 bg-brand-soft text-brand',
  neutral: 'border-line bg-card text-ink-2',
  warning: 'border-warning/40 bg-warning-soft text-warning-strong',
  critical: 'border-critical/40 bg-critical-soft text-critical',
  success: 'border-success/40 bg-success-soft text-success',
};

const TONE_DOT: Record<string, string> = {
  brand: 'bg-brand',
  neutral: 'bg-ink-3',
  warning: 'bg-warning',
  critical: 'bg-critical',
  success: 'bg-success',
};

/**
 * "The 60-second morning" — pinned narrative (250vh scroll). Left: four partner
 * questions swap with scroll progress. Right: mini Command-Centre chip cluster
 * that re-arranges per question.
 */
export default function PinnedNarrative() {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const qEls = gsap.utils.toArray<HTMLElement>('.np-question');
      gsap.set(qEls, { opacity: 0, y: 24 });
      gsap.set(qEls[0], { opacity: 1, y: 0 });

      ScrollTrigger.create({
        trigger: root.current,
        start: 'top top',
        end: '+=150%',
        pin: true,
        scrub: false,
        onUpdate: (self) => {
          const idx = Math.min(QUESTIONS.length - 1, Math.floor(self.progress * QUESTIONS.length));
          setStep((prev) => {
            if (prev === idx) return prev;
            gsap.to(qEls[prev], { opacity: 0, y: -24, duration: 0.35, ease: 'power2.out' });
            gsap.fromTo(qEls[idx], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
            return idx;
          });
        },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} id="why" className="relative bg-brand-deep">
      <div className="mx-auto grid min-h-[100dvh] w-full max-w-[1440px] items-center gap-12 px-6 lg:grid-cols-2">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] text-gold uppercase">The 60-second morning</p>
          <div className="relative mt-6 h-[120px]">
            {QUESTIONS.map((item, i) => (
              <h2
                key={item.q}
                className={cn(
                  'np-question absolute inset-x-0 top-0 font-display text-[34px] leading-tight font-medium text-paper md:text-[40px]',
                  prefersReducedMotion() && i !== step && 'hidden',
                )}
              >
                {item.q}
              </h2>
            ))}
          </div>
          <p className="mt-4 max-w-md text-[15px] leading-7 text-paper/60">
            Every morning, CAOS answers the four questions a partner actually asks — before the first coffee.
          </p>
          {/* progress dots */}
          <div className="mt-8 flex gap-2">
            {QUESTIONS.map((item, i) => (
              <span key={item.q} className={cn('h-1 rounded-full transition-all duration-300', i === step ? 'w-8 bg-gold' : 'w-3 bg-paper/25')} />
            ))}
          </div>
        </div>

        {/* Mini command-centre chip cluster — re-arranges per question via CSS order transitions */}
        <div className="relative rounded-2xl border border-paper/10 bg-paper/5 p-6 backdrop-blur-sm">
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
            style={{ backgroundImage: 'url(/pattern-ledger.svg)', backgroundSize: '220px' }}
            aria-hidden
          />
          <div className="relative flex flex-col gap-3">
            {QUESTIONS[step].chips.map((chip, i) => (
              <div
                key={chip.label}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[13px] font-medium shadow-card transition-all duration-500',
                  TONE_STYLES[chip.tone],
                )}
                style={{
                  transform: `translateX(${i * 14}px)`,
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[chip.tone])} />
                {chip.label}
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between rounded-lg border border-paper/10 px-4 py-2">
              <span className="font-mono text-[10px] tracking-[0.12em] text-paper/45 uppercase">Command Centre · live</span>
              <span className="font-mono text-[10px] text-gold">1,284 active</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
