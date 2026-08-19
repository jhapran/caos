import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, Paperclip, RotateCcw, Sparkles } from 'lucide-react';
import { AskCAOSBar } from '@/components/AskCAOS';
import Badge from '@/components/Badge';
import {
  ASK_FIXTURES,
  CLIENTS,
  SUGGESTED_QUESTIONS,
  askCaos,
  useDemoStore,
} from '@/data';
import EmptyHero from './ask/EmptyHero';
import InsightRail from './ask/InsightRail';
import Turn from './ask/Turn';
import type { ConversationTurn } from './ask/types';

/**
 * Ask CAOS — full-page conversational NL interface (`/ask`).
 * Violet AI surface: suggested questions, streamed structured answers with
 * parsed-filter chip trays, follow-up chaining, graceful fallback.
 */
export default function AskCaos() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sendReminder, notify } = useDemoStore();

  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState(0);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const seq = useRef(0);
  const handledParam = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** Run a query through the (simulated-latency) CAOS answer engine. */
  const ask = useCallback((query: string) => {
    const id = ++seq.current;
    setTurns((t) => [...t, { id, query }]);
    setPending(true);
    void askCaos(query).then((answer) => {
      const isFallback = !ASK_FIXTURES.includes(answer);
      setTurns((t) => t.map((turn) => (turn.id === id ? { ...turn, answer, isFallback } : turn)));
      setPending(false);
    });
  }, []);

  /** Follow-ups chain new queries; action-phrased ones also fire demo side-effects. */
  const handleFollowUp = useCallback(
    (q: string) => {
      if (/remind/i.test(q)) {
        const client = CLIENTS.find((c) => q.toLowerCase().includes(c.name.toLowerCase()));
        if (client) sendReminder(client.id);
        else notify('Reminders queued to all matching clients', 'success');
      } else if (/escalat/i.test(q)) {
        notify('Escalation drafted — ready for partner sign-off', 'info');
      }
      ask(q);
    },
    [ask, sendReminder, notify],
  );

  // Pre-run a query passed via ?q= (from Command Centre / Morning Brief bars).
  useEffect(() => {
    const q = searchParams.get('q');
    if (q && handledParam.current !== q) {
      handledParam.current = q;
      ask(q);
    }
  }, [searchParams, ask]);

  // Cycle the composer placeholder through the seeded questions.
  useEffect(() => {
    const id = window.setInterval(() => setPlaceholderIdx((i) => (i + 1) % SUGGESTED_QUESTIONS.length), 3500);
    return () => window.clearInterval(id);
  }, []);

  // Keep the latest turn pinned into view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const newConversation = () => {
    setTurns([]);
    setConversationId((c) => c + 1);
    handledParam.current = null;
    if (searchParams.has('q')) setSearchParams({}, { replace: true });
  };

  const empty = turns.length === 0;

  return (
    <div className="flex items-start gap-8">
      {/* Conversation canvas */}
      <div className="mx-auto flex min-h-[calc(100dvh-180px)] w-full max-w-[860px] flex-col">
        {/* Header row */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-soft">
              <Sparkles className="h-[18px] w-[18px] text-violet" strokeWidth={1.8} />
            </span>
            <div>
              <h1 className="text-[17px] leading-6 font-semibold text-ink">Ask CAOS</h1>
              <p className="text-[12px] text-ink-3">Natural-language firm intelligence</p>
            </div>
            <Badge tone="violet" className="ml-1">AI</Badge>
          </div>
          {!empty && (
            <button
              type="button"
              onClick={newConversation}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-violet/40 hover:text-violet"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              New conversation
            </button>
          )}
        </motion.div>

        {/* Conversation body */}
        <div className="mt-5 flex flex-1 flex-col">
          <AnimatePresence mode="wait">
            {empty ? (
              <motion.div key={`empty-${conversationId}`} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }} className="flex flex-1">
                <EmptyHero onAsk={ask} />
              </motion.div>
            ) : (
              <motion.div
                key={`conv-${conversationId}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
                className="space-y-8 pb-4"
              >
                {turns.map((turn) => (
                  <Turn key={turn.id} turn={turn} onFollowUp={handleFollowUp} />
                ))}
                <div ref={bottomRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Composer — sticky bottom bar */}
        <div className="sticky bottom-0 z-10 -mx-2 mt-4 border-t border-line bg-paper/90 px-2 pt-3 pb-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <AskCAOSBar
                onAsk={ask}
                placeholder={SUGGESTED_QUESTIONS[placeholderIdx]}
                loading={pending}
                autoFocus
                large
              />
            </div>
            <button
              type="button"
              title="Demo only"
              onClick={() => notify('Attachments are illustrative in this demo', 'info')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink-3 transition-colors hover:border-violet/40 hover:text-violet"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Demo only"
              onClick={() => notify('Voice input is illustrative in this demo', 'info')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink-3 transition-colors hover:border-violet/40 hover:text-violet"
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1.5 flex justify-end">
            <span className="font-mono text-[10px] tracking-[0.04em] text-ink-3">Demo answers are pre-computed</span>
          </div>
        </div>
      </div>

      {/* Right insight rail (xl only) */}
      <InsightRail onAsk={ask} />
    </div>
  );
}
