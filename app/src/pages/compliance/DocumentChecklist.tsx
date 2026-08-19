// Documents checklist card (right rail of Compliance Detail).
// Missing rows carry inline Request / Mark received actions; state chips pop in.
import { motion } from 'framer-motion';
import { FileCheck, FileClock, FileText, FileX, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DocState = 'received' | 'unread' | 'missing';

export interface DocRow {
  key: string;
  name: string;
  note?: string;
  state: DocState;
  /** links the row back to task.missingDocs when it represents a missing doc */
  missingKey?: string;
}

const STATE_META: Record<DocState, { chip: string; label: string; Icon: typeof FileCheck; iconCls: string }> = {
  received: { chip: 'bg-success-soft text-success', label: 'Received', Icon: FileCheck, iconCls: 'text-success' },
  unread: { chip: 'bg-warning-soft text-warning-strong', label: 'Received · unread', Icon: FileClock, iconCls: 'text-warning-strong' },
  missing: { chip: 'bg-critical-soft text-critical', label: 'Missing', Icon: FileX, iconCls: 'text-critical' },
};

export default function DocumentChecklist({
  rows,
  onRequest,
  onMarkReceived,
}: {
  rows: DocRow[];
  onRequest: (row: DocRow) => void;
  onMarkReceived: (row: DocRow) => void;
}) {
  return (
    <ul className="divide-y divide-line/70">
      {rows.map((row, i) => {
        const meta = STATE_META[row.state];
        const Icon = row.state === 'received' && row.note ? FileText : meta.Icon;
        return (
          <motion.li
            key={row.key}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut', delay: i * 0.06 }}
            className="flex items-center gap-3 py-2.5"
          >
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-deep', meta.iconCls)}>
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{row.name}</span>
              {row.note && <span className="block text-[11px] text-ink-3">{row.note}</span>}
            </span>
            <motion.span
              key={row.state}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2, ease: 'backOut' }}
              className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', meta.chip)}
            >
              {meta.label}
            </motion.span>
            {row.state === 'missing' && (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onRequest(row)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
                >
                  <Inbox className="h-3 w-3" /> Request
                </button>
                <button
                  type="button"
                  onClick={() => onMarkReceived(row)}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-success hover:bg-success-soft hover:text-success"
                >
                  Mark received
                </button>
              </span>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}
