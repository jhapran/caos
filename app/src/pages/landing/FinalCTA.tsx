import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Footer from '@/components/Footer';

const COMPLIANCES = ['GST', 'TDS', 'ITR', 'Tax Audit', 'MCA', 'PF/ESI'];

/** Section 5 — trust strip + final CTA (dark), plus footer. */
export default function FinalCTA({ onEnter }: { onEnter: (e: React.MouseEvent) => void }) {
  return (
    <section id="security" className="relative overflow-hidden bg-brand-deep">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ backgroundImage: 'url(/pattern-ledger.svg)', backgroundSize: '400px' }}
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-[1440px] px-6 py-24 text-center">
        {/* Trust strip */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7 }}
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-[12px] tracking-[0.14em] text-paper/60 uppercase"
        >
          {COMPLIANCES.map((c, i) => (
            <span key={c} className="flex items-center gap-3">
              {i > 0 && <span className="h-1 w-1 rounded-full bg-gold" aria-hidden />}
              {c}
            </span>
          ))}
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-4 text-[13px] text-paper/50"
        >
          Built for Indian CA firms of 5–50 people · 100–2,000 client entities.
        </motion.p>

        {/* Final panel */}
        <motion.h2
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
          className="mx-auto mt-16 font-display text-[36px] leading-tight font-medium text-paper md:text-[44px]"
        >
          See your firm run on CAOS.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
          className="mx-auto mt-4 max-w-lg text-[15px] leading-7 text-paper/65"
        >
          Explore the Firm Command Centre with realistic data for Sharma &amp; Associates.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
          className="mt-9"
        >
          <button
            type="button"
            onClick={onEnter}
            className="group inline-flex items-center gap-2.5 rounded-lg bg-gold px-8 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-gold/90"
          >
            Enter Live Demo
            <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-1" />
          </button>
        </motion.div>
      </div>
      <Footer />
    </section>
  );
}
