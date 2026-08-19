import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Building2, FileText, LayoutGrid, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { searchAll } from '@/data/api';
import type { SearchHit } from '@/data/api';
import { cn } from '@/lib/utils';

const KIND_ICONS = {
  client: Building2,
  compliance: FileText,
  page: LayoutGrid,
} as const;

/** ⌘K command palette — jump to any client / compliance / page (seeded fuzzy list). */
export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const hits: SearchHit[] = useMemo(() => searchAll(query), [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === 'Enter' && hits[activeIdx]) {
        navigate(hits[activeIdx].href);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hits, activeIdx, navigate, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-ink/40"
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed top-[14vh] left-1/2 z-[60] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-card shadow-lift"
            role="dialog"
            aria-label="Command palette"
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Search className="h-4 w-4 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a client, compliance, or page…"
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
              />
              <kbd className="rounded border border-line bg-paper-deep px-1.5 py-0.5 font-mono text-[10px] text-ink-3">ESC</kbd>
            </div>
            <ul className="max-h-[320px] overflow-y-auto py-1.5">
              {hits.map((hit, i) => {
                const Icon = KIND_ICONS[hit.kind];
                return (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => {
                        navigate(hit.href);
                        onClose();
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        i === activeIdx ? 'bg-brand-soft/60' : '',
                      )}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-deep text-ink-2">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="flex-1">
                        <span className="block text-[13px] font-medium text-ink">{hit.label}</span>
                        <span className="block text-[11px] text-ink-3">{hit.sub}</span>
                      </span>
                      {i === activeIdx && <ArrowRight className="h-3.5 w-3.5 text-brand" />}
                    </button>
                  </li>
                );
              })}
              {hits.length === 0 && (
                <li className="px-4 py-8 text-center text-[13px] text-ink-3">No matches for “{query}”</li>
              )}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
