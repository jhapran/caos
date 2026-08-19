import { useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { SegmentedControl } from '@/components/Tabs';
import { DEMO_TODAY, useDemoStore } from '@/data';
import ComplianceHealth from './command/ComplianceHealth';
import DeadlinesCard from './command/DeadlinesCard';
import DependencyCard from './command/DependencyCard';
import ReviewQueueCard from './command/ReviewQueueCard';
import RiskAlertsCard from './command/RiskAlertsCard';
import AskCaosStrip from './command/AskCaosStrip';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/**
 * Firm Command Centre (/command) — the star page.
 * Sections A–E of the PRD on one dense, fully drillable dashboard plus the
 * Ask CAOS strip. 12-col grid: main column (8) + right rail (4) on xl.
 */
export default function CommandCentre() {
  const { notify } = useDemoStore();
  const [fy, setFy] = useState('fy2425');

  return (
    <div className="space-y-6">
      {/* Section 0 — page header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.01em] text-ink">Firm Command Centre</h1>
          <p className="mt-1 text-[14px] leading-5 text-ink-2">What requires attention today — across every client.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            items={[
              { id: 'fy2425', label: 'FY 2024-25' },
              { id: 'fy2324', label: 'FY 2023-24' },
            ]}
            active={fy}
            onChange={(id) => {
              if (id === 'fy2425') {
                setFy(id);
              } else {
                notify('This demo is seeded for FY 2024-25 only', 'info');
              }
            }}
          />
          <span className="hidden rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] text-ink-2 sm:inline-flex">
            {format(DEMO_TODAY, 'EEE, dd MMM yyyy')}
          </span>
          <span className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            Last synced 09:12
          </span>
        </div>
      </motion.div>

      {/* Section A — Compliance Health (full width) */}
      <ComplianceHealth delay={0.05} />

      {/* Sections B–E — 12-col grid */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <DeadlinesCard delay={0.1} />
          <DependencyCard delay={0.16} />
          <AskCaosStrip delay={0.22} />
        </div>
        <div className="space-y-6 xl:col-span-4">
          <ReviewQueueCard delay={0.14} />
          <RiskAlertsCard delay={0.2} />
        </div>
      </div>
    </div>
  );
}
