import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { EnterDemoButton } from './EnterDemoButton';
import { cn } from '@/lib/utils';

/** Landing nav — transparent over hero → brand-deep/90 blur + hairline on scroll. */
export default function LandingNav({ onEnter }: { onEnter: (e: React.MouseEvent) => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const anchor = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled ? 'border-b border-paper/10 bg-brand-deep/90 backdrop-blur-md' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-[68px] w-full max-w-[1440px] items-center gap-6 px-6">
        <img src="/logo.svg" alt="CAOS" className="h-8 w-auto" />
        <nav className="hidden flex-1 items-center justify-center gap-8 md:flex" aria-label="Landing">
          {[
            { label: 'Product', href: '#product' },
            { label: 'Why CAOS', href: '#why' },
            { label: 'Security', href: '#security' },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              onClick={anchor(l.href)}
              className="text-[13px] font-medium text-paper/70 transition-colors hover:text-paper"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 md:ml-0">
          <span className="hidden font-mono text-[11px] tracking-[0.08em] text-gold uppercase lg:inline">
            Seeded interactive demo
          </span>
          <EnterDemoButton onEnter={onEnter} pulse />
        </div>
      </div>
    </motion.header>
  );
}
