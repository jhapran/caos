import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Building2,
  FileBadge,
  FileText,
  Landmark,
  LayoutGrid,
  ListChecks,
  Search,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  searchAll,
  searchService,
  STRUCTURED_SEARCH_MIN_QUERY_LENGTH,
} from '@/data';
import type { SearchHit, StructuredSearchHit } from '@/data';
import { useAuth } from '@/data/auth';
import { cn } from '@/lib/utils';

const KIND_ICONS = {
  client: Building2,
  legal_entity: Landmark,
  registration: FileBadge,
  task: ListChecks,
  compliance_instance: FileText,
  staff: Users,
  compliance: FileText,
  page: LayoutGrid,
} as const;

/** One normalized palette row: fixture SearchHit and live
 *  StructuredSearchHit share kind/id/label/sub; href is OPTIONAL (IMP061
 *  R11-A) — a null href renders a truthful non-navigable row. */
interface PaletteItem {
  key: string;
  kind: keyof typeof KIND_ICONS;
  label: string;
  sub: string | null;
  href: string | null;
  status: string | null;
}

/**
 * Supabase-mode short-query entries: navigation to modules that actually
 * serve hosted data. Below the live-search minimum length (IMP061-R4) the
 * palette shows ONLY these client-side page shortcuts — never tenant data.
 */
const SUPABASE_NAV: PaletteItem[] = [
  { key: 'nav-clients', kind: 'page', label: 'Clients', sub: 'Hosted client portfolio', href: '/clients', status: null },
  { key: 'nav-review', kind: 'page', label: 'Review Queue', sub: 'Hosted review queue', href: '/review', status: null },
];

function supabaseNavItems(query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SUPABASE_NAV;
  return SUPABASE_NAV.filter((h) => h.label.toLowerCase().includes(q));
}

const LIVE_DEBOUNCE_MS = 250;

/** ⌘K command palette — fixture mode keeps the seeded demo search; Supabase
 *  mode runs IMP-061 live structured search (API-R0-SRC) through
 *  searchService once the query reaches the minimum length. */
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
  const { service } = useAuth();
  const fixture = service.mode === 'fixture';

  // Live structured-search state (Supabase mode only). `idle` = below the
  // minimum query length (page shortcuts show instead).
  const [liveHits, setLiveHits] = useState<StructuredSearchHit[]>([]);
  const [liveState, setLiveState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const trimmed = query.trim();
  const liveActive = !fixture && trimmed.length >= STRUCTURED_SEARCH_MIN_QUERY_LENGTH;

  // Query-change bookkeeping uses the adjust-during-render pattern (the
  // file's existing convention): a new query clears the previous hits and
  // moves to loading/idle; the effect cleanup below cancels any in-flight
  // request, so a slower earlier response can never overwrite a later
  // query's state (stale-response race guard).
  const [prevTrimmed, setPrevTrimmed] = useState(trimmed);
  if (prevTrimmed !== trimmed) {
    setPrevTrimmed(trimmed);
    setLiveHits([]);
    setLiveState(liveActive ? 'loading' : 'idle');
  }

  useEffect(() => {
    if (fixture || !open || !liveActive) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchService
        .searchStructured(trimmed)
        .then((hits) => {
          if (cancelled) return;
          setLiveHits(hits);
          setLiveState('ready');
        })
        .catch(() => {
          // Truthful error state; the raw query is never logged or
          // interpolated here (IMP061-R9). No fixture fallback (MIG-DS-05).
          if (cancelled) return;
          setLiveHits([]);
          setLiveState('error');
        });
    }, LIVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fixture, open, liveActive, trimmed]);

  const items: PaletteItem[] = useMemo(() => {
    if (fixture) {
      return searchAll(query).map((h: SearchHit) => ({
        key: h.id,
        kind: h.kind,
        label: h.label,
        sub: h.sub,
        href: h.href,
        status: null,
      }));
    }
    if (!liveActive) return supabaseNavItems(query);
    return liveHits.map((h) => ({
      key: `${h.kind}:${h.id}`,
      kind: h.kind,
      label: h.label,
      sub: h.sub,
      href: h.href,
      status: h.status,
    }));
  }, [fixture, liveActive, liveHits, query]);

  // Reset transient state during render when the palette opens or the query
  // changes (docs-sanctioned adjust-during-render pattern); effects below
  // own only DOM focus and keyboard subscription.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setActiveIdx(0);
    }
  }
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActiveIdx(0);
  }

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(items.length - 1, i + 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === 'Enter') {
        const item = items[activeIdx];
        // R11-A: Enter navigates ONLY for a hit with a truthful destination;
        // a non-navigable hit never navigates and never closes the palette.
        if (item?.href) {
          navigate(item.href);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, activeIdx, navigate, onClose]);

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
                placeholder={fixture ? 'Jump to a client, compliance, or page…' : 'Search clients, entities, tasks, staff…'}
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
              />
              <kbd className="rounded border border-line bg-paper-deep px-1.5 py-0.5 font-mono text-[10px] text-ink-3">ESC</kbd>
            </div>
            <ul className="max-h-[320px] overflow-y-auto py-1.5">
              {items.map((item, i) => {
                const Icon = KIND_ICONS[item.kind];
                const navigable = item.href !== null;
                return (
                  <li key={item.key}>
                    {navigable ? (
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => {
                          navigate(item.href as string);
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
                          <span className="block text-[13px] font-medium text-ink">
                            {item.label}
                            {item.status === 'offboarded' && (
                              <span className="ml-2 rounded border border-warning/40 bg-warning/10 px-1 py-0.5 align-middle text-[10px] font-medium text-warning">
                                Offboarded
                              </span>
                            )}
                          </span>
                          {item.sub && <span className="block text-[11px] text-ink-3">{item.sub}</span>}
                        </span>
                        {i === activeIdx && <ArrowRight className="h-3.5 w-3.5 text-brand" />}
                      </button>
                    ) : (
                      // R11-A: a hit without a truthful destination stays
                      // visible but carries NO navigation affordance — not a
                      // button, no ArrowRight, click/Enter do nothing and the
                      // palette stays open.
                      <div
                        onMouseEnter={() => setActiveIdx(i)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          i === activeIdx ? 'bg-brand-soft/60' : '',
                        )}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper-deep text-ink-2">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1">
                          <span className="block text-[13px] font-medium text-ink">{item.label}</span>
                          {item.sub && <span className="block text-[11px] text-ink-3">{item.sub}</span>}
                        </span>
                        <span className="text-[10px] text-ink-3">No detail page</span>
                      </div>
                    )}
                  </li>
                );
              })}
              {!fixture && liveActive && liveState === 'loading' && (
                <li className="px-4 py-8 text-center text-[13px] text-ink-3">Searching…</li>
              )}
              {!fixture && liveActive && liveState === 'error' && (
                <li className="px-4 py-8 text-center text-[13px] text-ink-3">
                  Search is unavailable right now. Try again in a moment.
                </li>
              )}
              {items.length === 0 && !liveActive && (
                <li className="px-4 py-8 text-center text-[13px] text-ink-3">
                  {fixture ? (
                    <>No matches for “{query}”</>
                  ) : (
                    <>No matching pages. Type at least {STRUCTURED_SEARCH_MIN_QUERY_LENGTH} characters to search hosted data.</>
                  )}
                </li>
              )}
              {items.length === 0 && liveActive && liveState === 'ready' && (
                <li className="px-4 py-8 text-center text-[13px] text-ink-3">No results for “{trimmed}”</li>
              )}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
