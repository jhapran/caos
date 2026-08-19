import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ArrowDown } from 'lucide-react';
import { EnterDemoButton } from './EnterDemoButton';
import { prefersReducedMotion } from '@/components/CountUp';

const EYEBROW = 'CAOS · CA OPERATING SYSTEM';

/** Hero — 100vh dark, mesh bg + ledger overlay, kinetic serif headline, tilted dashboard preview. */
export default function HeroSection({ onEnter }: { onEnter: (e: React.MouseEvent) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [eyebrow, setEyebrow] = useState(() => (prefersReducedMotion() ? EYEBROW : ''));

  // Eyebrow types in mono letter-by-letter (30ms)
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setEyebrow(EYEBROW.slice(0, i));
      if (i >= EYEBROW.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, []);

  useGSAP(
    () => {
      if (prefersReducedMotion()) {
        gsap.set('.hero-word, .hero-sub, .hero-ctas, .hero-preview', { opacity: 1, y: 0, rotate: 0 });
        return;
      }
      const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
      tl.fromTo(
        '.hero-word',
        { y: 60, opacity: 0, rotate: 4 },
        { y: 0, opacity: 1, rotate: 0, duration: 0.9, stagger: 0.06 },
        0.35,
      )
        .fromTo('.hero-sub', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 }, '-=0.45')
        .fromTo('.hero-ctas', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, '-=0.4')
        .fromTo('.hero-preview', { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1 }, '-=0.5');
      // Idle float (y ±8px, 6s sine)
      gsap.to('.hero-preview-inner', {
        y: -8,
        duration: 3,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: 1.6,
      });
    },
    { scope: root },
  );

  const words = 'The Operating System for Modern CA Firms.'.split(' ');

  return (
    <section ref={root} className="relative flex min-h-[100dvh] items-center overflow-hidden bg-brand-deep" id="product">
      {/* Mesh background + ledger overlay + slow drift */}
      <div
        className="absolute inset-0 animate-mesh-breathe bg-cover bg-center will-change-transform"
        style={{ backgroundImage: 'url(/hero-mesh.png)' }}
        aria-hidden
      />
      <div
        className="absolute inset-0 animate-mesh-drift opacity-[0.04]"
        style={{ backgroundImage: 'url(/pattern-ledger.svg)', backgroundSize: '400px' }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-b from-brand-deep/40 via-transparent to-brand-deep/80" aria-hidden />

      <div className="relative mx-auto grid w-full max-w-[1440px] items-center gap-12 px-6 pt-32 pb-20 lg:grid-cols-2 lg:gap-8">
        <div>
          <p className="font-mono text-[12px] tracking-[0.2em] text-gold uppercase">
            {eyebrow}
            {eyebrow.length < EYEBROW.length && <span className="ml-0.5 inline-block h-3 w-[2px] animate-caret-blink bg-gold align-middle" />}
          </p>
          <h1 className="mt-5 font-display text-[44px] leading-[1.06] font-medium tracking-[-0.01em] text-paper md:text-[56px] lg:text-[64px] lg:leading-[68px]">
            {words.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-1 align-bottom">
                <span
                  className="hero-word inline-block will-change-transform"
                  style={
                    w === 'Operating' || w === 'System'
                      ? { fontStyle: 'italic', color: '#D9A94A' }
                      : undefined
                  }
                >
                  {w}
                  {i < words.length - 1 ? ' ' : ''}
                </span>
              </span>
            ))}
          </h1>
          <p className="hero-sub mt-6 max-w-[560px] text-[17px] leading-7 text-paper/70">
            Your accounting software manages accounts. Your tax software files returns.{' '}
            <strong className="font-semibold text-paper">CAOS manages everything in between.</strong>{' '}
            Know what is due, what is missing, who is responsible, and what needs attention — across every client.
          </p>
          <div className="hero-ctas mt-8 flex flex-wrap items-center gap-5">
            <EnterDemoButton onEnter={onEnter} size="lg" />
            <a
              href="#why"
              onClick={(e) => {
                e.preventDefault();
                document.querySelector('#why')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-paper/70 transition-colors hover:text-paper"
            >
              See what’s inside
              <ArrowDown className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5" />
            </a>
          </div>
        </div>

        {/* Dashboard preview in a tilted 3D card */}
        <div className="hero-preview relative hidden lg:block" style={{ perspective: '1200px' }}>
          <div
            className="hero-preview-inner relative rounded-xl border border-gold/40 bg-card/5 p-1.5 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)] will-change-transform"
            style={{ transform: 'rotateX(8deg) rotateY(-12deg)', transformStyle: 'preserve-3d' }}
          >
            <img
              src="/dashboard-preview.png"
              alt="CAOS Firm Command Centre preview"
              className="w-full rounded-lg"
              width={1600}
              height={1000}
            />
          </div>
          <div className="absolute -bottom-10 left-1/2 h-10 w-3/4 -translate-x-1/2 rounded-[50%] bg-black/40 blur-2xl" aria-hidden />
        </div>
      </div>
    </section>
  );
}
