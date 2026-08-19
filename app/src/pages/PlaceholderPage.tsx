import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Construction } from 'lucide-react';

/** Placeholder scaffold for pages owned by page agents. */
export default function PlaceholderPage({
  title,
  description,
  icon: Icon = Construction,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">{title}</h1>
      <p className="mt-1 text-[14px] text-ink-2">{description}</p>
      <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
          <Icon className="h-5 w-5 text-brand" strokeWidth={1.8} />
        </span>
        <p className="mt-4 text-[14px] font-medium text-ink">This page is being assembled</p>
        <p className="mt-1 max-w-md text-[13px] text-ink-3">
          Scaffold route is live — the shared shell, data layer, and components are ready for the page implementation.
        </p>
      </div>
    </motion.div>
  );
}
