import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useDemoStore } from '@/data/store';
import { cn } from '@/lib/utils';

const ICONS = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  critical: XCircle,
} as const;

const STYLES = {
  success: 'border-brand/30 bg-card text-ink [&_svg]:text-brand',
  info: 'border-info/30 bg-card text-ink [&_svg]:text-info',
  warning: 'border-warning/40 bg-card text-ink [&_svg]:text-warning-strong',
  critical: 'border-critical/30 bg-card text-ink [&_svg]:text-critical',
} as const;

/**
 * Toast viewport — bottom-right, auto-dismiss 4s (handled by the store).
 * Render once inside the app shell: <ToastViewport />
 * Trigger from anywhere: const { notify } = useDemoStore(); notify('Reminder sent to ABC Pvt Ltd')
 */
export default function ToastViewport() {
  const { toasts, dismissToast } = useDemoStore();
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[70] flex w-[340px] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <motion.div
              key={toast.id}
              layout="position"
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
              className={cn('pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-lift', STYLES[toast.kind])}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
              <span className="flex-1 text-[13px] font-medium">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss"
                className="rounded p-0.5 text-ink-3 transition-colors hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
