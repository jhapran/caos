import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  RotateCcw,
  Sparkles,
  UserCog,
} from 'lucide-react';
import Avatar from '@/components/Avatar';
import StatusPill from '@/components/StatusPill';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getClient, ownerOf } from '@/data';
import type { ReviewItem } from '@/data';
import { cn } from '@/lib/utils';
import { docsFor, preChecksFor } from './meta';

/** Faux preview grid inside the document lightbox (no real file content in demo). */
function FauxPreview({ name }: { name: string }) {
  const headers = ['Ref', 'Particulars', 'Debit (₹)', 'Credit (₹)', 'Status'];
  const rows = [
    ['JV-1182', 'Reliance Industries Ltd — INV-2281', '1,18,240', '—', 'Matched'],
    ['PV-0907', 'Uday Transport — freight Aug', '42,180', '—', 'Variance ₹4,820'],
    ['BR-3310', 'ICICI Bank — NEFT sweep', '—', '96,500', 'Matched'],
    ['JV-1190', 'Depreciation — Plant & Machinery', '58,412', '—', 'Matched'],
    ['SV-2041', 'Mehta Trading Co — sales Aug', '—', '2,14,900', 'Matched'],
  ];
  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-[12px] leading-5">
          <thead>
            <tr className="bg-paper-deep/70">
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left text-caption">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-t border-line/60">
                {r.map((c, i) => (
                  <td key={i} className={cn('px-3 py-2', i >= 2 && i <= 3 ? 'text-right font-mono tnum' : '', i === 4 ? (c === 'Matched' ? 'text-success' : 'text-warning-strong') : 'text-ink-2')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-right font-mono text-[10px] tracking-[0.04em] text-ink-3 uppercase">{name} · Demo preview</p>
    </div>
  );
}

interface InspectorProps {
  item: ReviewItem | null;
  onApprove: (id: string, comment?: string) => void;
  onReturn: (id: string, reason: string) => void;
  onReassign: (id: string) => void;
  /** Bumped by the page when the keyboard "R" shortcut fires. */
  returnRequestKey: number;
}

/** Inspector pane: pre-checks, documents, comments, approve / return / reassign. */
export default function Inspector({ item, onApprove, onReturn, onReassign, returnRequestKey }: InspectorProps) {
  const [docPreview, setDocPreview] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [approvedFlash, setApprovedFlash] = useState(false);
  const [localNotes, setLocalNotes] = useState<Record<string, { by: string; text: string }[]>>({});
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  // Reset transient UI on selection change.
  useEffect(() => {
    setReturnOpen(false);
    setReason('');
    setApprovedFlash(false);
  }, [item?.id]);

  // Keyboard "R" from the page opens + focuses the return reason field.
  useEffect(() => {
    if (returnRequestKey > 0 && item) {
      setReturnOpen(true);
      window.setTimeout(() => reasonRef.current?.focus(), 250);
    }
  }, [returnRequestKey, item]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-card px-6 py-20 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-soft">
          <Sparkles className="h-5 w-5 text-violet" strokeWidth={1.8} />
        </span>
        <p className="mt-4 text-[14px] font-medium text-ink">Nothing selected</p>
        <p className="mt-1 text-[13px] text-ink-3">Pick an item from the queue to inspect it.</p>
      </div>
    );
  }

  const client = getClient(item.clientId);
  const submitter = ownerOf(item.submittedBy);
  const owner = client ? ownerOf(client.ownerId) : submitter;
  const checks = preChecksFor(item);
  const docs = docsFor(item);
  const comments = [...item.comments, ...(localNotes[item.id] ?? [])];

  const approve = () => {
    if (approvedFlash) return;
    setApprovedFlash(true);
    const comment = note.trim() || undefined;
    setNote('');
    flashTimer.current = window.setTimeout(() => onApprove(item.id, comment), 650);
  };

  const submitReturn = () => {
    onReturn(item.id, reason.trim());
    setReason('');
    setReturnOpen(false);
  };

  const addNote = () => {
    if (!note.trim()) return;
    setLocalNotes((m) => ({
      ...m,
      [item.id]: [...(m[item.id] ?? []), { by: 'CA Pranav Kumar', text: note.trim() }],
    }));
    setNote('');
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-card">
      <AnimatePresence mode="wait">
        <motion.div
          key={item.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.25 } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          className="flex min-h-[560px] flex-col"
        >
          {/* Header */}
          <div className="border-b border-line px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] leading-6 font-semibold text-ink">{item.title}</h2>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {client?.name} · {client?.industry}, {client?.city} · <span className="font-mono">{item.period}</span>
                </p>
              </div>
              <StatusPill status="Under Review" size="sm" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pr-2.5 pl-0.5 text-[11px] text-ink-2">
                <Avatar name={submitter.name} size="xs" /> Prepared by {submitter.name}
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pr-2.5 pl-0.5 text-[11px] text-ink-2">
                <Avatar name={owner.name} size="xs" /> Client owner {owner.name}
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-5 px-5 py-4">
            {/* What CAOS pre-checked */}
            <div className="rounded-lg border border-violet/20 bg-violet-soft/60 px-4 py-3">
              <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-violet uppercase">
                <Sparkles className="h-3.5 w-3.5" /> What CAOS pre-checked
              </p>
              <ul className="mt-2.5 space-y-2">
                {checks.map((c, i) => (
                  <motion.li
                    key={c.text}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 * i + 0.15, duration: 0.3 }}
                    className="flex items-start gap-2 text-[12.5px] leading-5 text-ink-2"
                  >
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    )}
                    {c.text}
                  </motion.li>
                ))}
              </ul>
            </div>

            {/* Documents */}
            <div>
              <p className="text-caption">Documents</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {docs.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDocPreview(d)}
                    className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-brand" strokeWidth={1.8} />
                    <span className="font-mono text-[11.5px]">{d}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Comments */}
            <div>
              <p className="text-caption">Comments</p>
              <ul className="mt-2 space-y-3">
                {comments.map((c, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Avatar name={c.by} size="xs" className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-ink">{c.by}</p>
                      <p className="text-[12.5px] leading-5 text-ink-2">{c.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addNote();
                  }}
                  placeholder="Add a reviewer note…"
                  className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-brand/50"
                />
                <button
                  type="button"
                  onClick={addNote}
                  disabled={!note.trim()}
                  className="rounded-lg border border-line bg-card px-3 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Return reason — expands inline with a layout spring */}
            <AnimatePresence>
              {returnOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-warning/30 bg-warning-soft/50 p-3">
                    <p className="text-[12px] font-semibold text-warning-strong">Return reason</p>
                    <textarea
                      ref={reasonRef}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="e.g. Please attach the revised purchase register for Aug…"
                      className="mt-2 w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-warning/60"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setReturnOpen(false)}
                        className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={submitReturn}
                        className="rounded-lg bg-warning px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-warning-strong"
                      >
                        Return to {submitter.name.split(' ')[0]}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Action bar — sticky bottom of inspector */}
          <div className="border-t border-line bg-card px-5 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={approve}
                disabled={approvedFlash}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all',
                  approvedFlash ? 'bg-success' : 'bg-brand hover:bg-brand-deep active:scale-[0.98]',
                )}
              >
                <motion.span
                  key={approvedFlash ? 'done' : 'idle'}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', duration: 0.35, bounce: 0.4 }}
                  className="flex items-center gap-1.5"
                >
                  <Check className="h-4 w-4" />
                  {approvedFlash ? 'Approved' : 'Approve'}
                </motion.span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setReturnOpen((o) => !o);
                  if (!returnOpen) window.setTimeout(() => reasonRef.current?.focus(), 250);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-[13px] font-medium text-warning-strong transition-colors hover:bg-warning-soft/60"
              >
                <RotateCcw className="h-4 w-4" />
                Return
              </button>
              <button
                type="button"
                onClick={() => onReassign(item.id)}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-4 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3/50 hover:text-ink"
              >
                <UserCog className="h-4 w-4" />
                Reassign
              </button>
            </div>
            <p className="mt-2 text-center font-mono text-[10px] tracking-[0.04em] text-ink-3">
              ↑↓ navigate · A approve · R return
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Document lightbox */}
      <Dialog open={docPreview !== null} onOpenChange={(open) => !open && setDocPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-[14px]">{docPreview}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {client?.name} · {item.period} · attached to this review item
            </DialogDescription>
          </DialogHeader>
          {docPreview && <FauxPreview name={docPreview} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
