import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import CountUp from '@/components/CountUp';

const CARDS = [
  {
    title: 'Compliance Health',
    blurb: '1,284 compliances, one truth.',
    snippet: (
      <div className="mt-4 space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[34px] leading-none font-medium text-brand tnum">
            <CountUp value={1284} duration={1.1} />
          </span>
          <span className="font-mono text-[10px] text-ink-3 uppercase">active</span>
        </div>
        {[
          { label: 'Completed', w: '71%', c: 'bg-success', n: '912' },
          { label: 'In progress', w: '17%', c: 'bg-info', n: '215' },
          { label: 'Waiting', w: '8%', c: 'bg-warning', n: '103' },
          { label: 'At risk', w: '4%', c: 'bg-critical', n: '16' },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-20 text-[11px] text-ink-3">{r.label}</span>
            <span className="h-1.5 flex-1 rounded-full bg-paper-deep">
              <span className={`block h-full rounded-full ${r.c}`} style={{ width: r.w }} />
            </span>
            <span className="w-8 text-right font-mono text-[11px] text-ink-2 tnum">{r.n}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Ask CAOS',
    blurb: 'Ask in English. Get a table, not a paragraph.',
    snippet: (
      <div className="mt-4">
        <div className="flex items-center gap-2 rounded-lg border border-violet/25 bg-violet-soft/60 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-violet" />
          <span className="text-[12px] text-ink-2">Which GSTR-3B filings are due this week?</span>
        </div>
        <div className="mt-2.5 overflow-hidden rounded-lg border border-line">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-paper-deep/70 text-left text-ink-3">
                <th className="px-2.5 py-1.5 font-medium">Client</th>
                <th className="px-2.5 py-1.5 font-medium">Due</th>
                <th className="px-2.5 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              <tr className="border-t border-line/60"><td className="px-2.5 py-1.5 font-medium text-ink">ABC Pvt Ltd</td><td className="px-2.5 py-1.5 tnum">20 Sep</td><td className="px-2.5 py-1.5"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-warning" />Waiting</span></td></tr>
              <tr className="border-t border-line/60"><td className="px-2.5 py-1.5 font-medium text-ink">LMN Ltd</td><td className="px-2.5 py-1.5 tnum">20 Sep</td><td className="px-2.5 py-1.5"><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-brand" />Ready</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    ),
  },
  {
    title: 'Explainable Risk',
    blurb: 'Risk score 82/100 — and exactly why.',
    snippet: (
      <div className="mt-4 space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[28px] leading-none font-medium text-critical tnum">82</span>
          <span className="font-mono text-[11px] text-ink-3">/ 100 · ABC Pvt Ltd</span>
        </div>
        {[
          { label: 'Work not started', pts: '+40' },
          { label: 'Overdue items', pts: '+28' },
          { label: 'Documents missing', pts: '+12' },
        ].map((f) => (
          <div key={f.label} className="flex items-center justify-between rounded-md bg-paper-deep/70 px-2.5 py-1.5">
            <span className="text-[11px] text-ink-2">{f.label}</span>
            <span className="font-mono text-[11px] font-medium text-critical tnum">{f.pts}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-line px-2.5 pt-1.5">
          <span className="text-[11px] font-medium text-ink">Total</span>
          <span className="font-mono text-[11px] font-semibold text-ink tnum">= 82</span>
        </div>
      </div>
    ),
  },
];

/** Section 4 — light band: "Every number answers a question." Three drill-down cards. */
export default function DrilldownSection() {
  return (
    <section className="bg-paper py-24">
      <div className="mx-auto w-full max-w-[1440px] px-6">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="font-display text-[34px] font-medium tracking-[-0.01em] text-ink md:text-[40px]"
        >
          Every number answers a question.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
          className="mt-3 max-w-xl text-[15px] leading-7 text-ink-2"
        >
          No vanity metrics. Every figure on the Command Centre drills into a real, filterable list — with the reason, the owner, and the last action attached.
        </motion.p>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {CARDS.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: i * 0.12, ease: 'easeOut' }}
              className="group rounded-xl border border-line bg-card p-6 shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
            >
              <h3 className="gold-underline-sweep inline-block text-[17px] font-semibold text-ink">
                {card.title}
              </h3>
              <p className="mt-1 text-[13px] text-ink-3">{card.blurb}</p>
              {card.snippet}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
