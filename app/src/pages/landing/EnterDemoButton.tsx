import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { prefersReducedMotion } from '@/components/CountUp';
import { cn } from '@/lib/utils';

/**
 * Enter Live Demo CTA — on click expands to a full-screen brand wipe
 * (clip-path circle from the button, 0.5s) then routes to /brief.
 */
export function useEnterDemo() {
  const [wipe, setWipe] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();

  const enter = useCallback(
    (e: React.MouseEvent) => {
      if (prefersReducedMotion()) {
        navigate('/brief');
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setWipe({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      window.setTimeout(() => navigate('/brief'), 480);
    },
    [navigate],
  );

  const wipeOverlay = (
    <AnimatePresence>
      {wipe && (
        <motion.div
          key="wipe"
          className="fixed inset-0 z-[90] bg-brand-deep"
          initial={{
            clipPath: `circle(0px at ${wipe.x}px ${wipe.y}px)`,
          }}
          animate={{
            clipPath: `circle(${Math.hypot(window.innerWidth, window.innerHeight)}px at ${wipe.x}px ${wipe.y}px)`,
          }}
          exit={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
    </AnimatePresence>
  );

  return { enter, wipeOverlay };
}

export function EnterDemoButton({
  onEnter,
  size = 'md',
  className,
  pulse = false,
}: {
  onEnter: (e: React.MouseEvent) => void;
  size?: 'md' | 'lg';
  className?: string;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onEnter}
      className={cn(
        'group inline-flex items-center gap-2 rounded-lg bg-brand font-medium text-white transition-colors hover:bg-brand-deep',
        size === 'lg' ? 'px-7 py-3.5 text-[15px]' : 'px-4 py-2 text-[13px]',
        pulse && 'animate-gold-pulse',
        className,
      )}
    >
      Enter Live Demo
      <ArrowRight className={cn('transition-transform duration-200 group-hover:translate-x-1', size === 'lg' ? 'h-[18px] w-[18px]' : 'h-4 w-4')} />
    </button>
  );
}
