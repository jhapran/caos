import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FileX2, Mail, MessageCircle, RotateCcw, Send, ShieldAlert } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Drawer from '@/components/Drawer';
import { getClient, useDemoStore } from '@/data';
import type { DependencyClient, Reminder } from '@/data';
import { cn } from '@/lib/utils';
import {
  baseReminderCount,
  buildReminderMessage,
  contactFor,
  entityCaption,
  fmtDateTime,
  fmtDay,
  ownerName,
} from './dependencyModel';

/** Right drawer: client quick-view + missing docs + reminder history + reminder composer. */
export default function ClientDrawer({
  client,
  onClose,
}: {
  client: DependencyClient | null;
  onClose: () => void;
}) {
  const { reminders, sendReminder, notify } = useDemoStore();
  const [channel, setChannel] = useState<'WhatsApp' | 'Email'>('WhatsApp');
  const [message, setMessage] = useState('');

  const contact = client ? contactFor(client.clientId) : null;
  const record = client ? getClient(client.clientId) : undefined;

  // Rebuild the merged template whenever the drawer target changes.
  useEffect(() => {
    if (client) {
      setChannel(contactFor(client.clientId).channel);
      setMessage(buildReminderMessage(client.clientName, client.missingDocs, client.clientId));
    }
  }, [client]);

  const history = useMemo<Reminder[]>(() => {
    if (!client) return [];
    const live = reminders[client.clientId] ?? [];
    const seeded: Reminder[] = [];
    if (client.lastReminderAt) {
      seeded.push({ sentAt: client.lastReminderAt, channel: contact?.channel ?? 'Email', by: ownerName(client.ownerId) });
    }
    // A couple of earlier seeded touches so the timeline feels real.
    const base = baseReminderCount(client.clientId);
    for (let i = 1; i < base; i++) {
      seeded.push({
        sentAt: new Date(new Date(client.lastReminderAt ?? Date.now()).getTime() - i * 3 * 86400000).toISOString(),
        channel: i % 2 === 0 ? 'Email' : 'WhatsApp',
        by: ownerName(client.ownerId),
      });
    }
    return [...live, ...seeded].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }, [client, reminders, contact]);

  const send = () => {
    if (!client) return;
    sendReminder(client.clientId, channel);
  };

  const escalate = () => {
    if (!client) return;
    notify(`Escalated — ${client.clientName} marked for a partner call`, 'warning');
  };

  return (
    <Drawer
      open={!!client}
      onClose={onClose}
      title={client?.clientName}
      subtitle={client ? entityCaption(client.clientId) : undefined}
    >
      {client && contact && (
        <div className="space-y-6">
          {/* Contact card */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="flex items-center gap-3 rounded-xl border border-line bg-paper-deep/50 p-4"
          >
            <Avatar name={contact.name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink">{contact.name}</div>
              <div className="text-[12px] text-ink-3">{contact.role} · prefers {contact.channel}</div>
              {record?.gstin && <div className="mt-0.5 font-mono text-[11px] text-ink-3">GSTIN {record.gstin}</div>}
            </div>
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand tnum">
              {client.blockingTasks} tasks blocked
            </span>
          </motion.section>

          {/* Missing documents */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.06, ease: 'easeOut' }}
          >
            <h3 className="flex items-center gap-2 text-caption">
              <FileX2 className="h-3.5 w-3.5 text-warning-strong" /> Missing documents
            </h3>
            <ul className="mt-2 space-y-2">
              {client.missingDocs.map((doc) => (
                <li
                  key={doc}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2"
                >
                  <span className="text-[13px] font-medium text-ink">{doc}</span>
                  <button
                    type="button"
                    onClick={() => notify(`Request resent — ${doc}`, 'info')}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    <RotateCcw className="h-3 w-3" /> Resend
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-ink-3">
              Oldest request <span className="font-semibold text-warning-strong tnum">{client.oldestWaitDays} days</span> ·
              owner {ownerName(client.ownerId)} · last reminder {fmtDay(client.lastReminderAt)}
            </p>
          </motion.section>

          {/* Reminder composer */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12, ease: 'easeOut' }}
            className="rounded-xl border border-brand/25 bg-brand-soft/40 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-caption">Send reminder</h3>
              <div className="inline-flex items-center gap-0.5 rounded-lg bg-card p-0.5">
                {(['WhatsApp', 'Email'] as const).map((ch) => {
                  const Icon = ch === 'WhatsApp' ? MessageCircle : Mail;
                  return (
                    <button
                      key={ch}
                      type="button"
                      aria-pressed={channel === ch}
                      onClick={() => setChannel(ch)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all',
                        channel === ch ? 'bg-brand text-white shadow-card' : 'text-ink-3 hover:text-ink-2',
                      )}
                    >
                      <Icon className="h-3 w-3" /> {ch}
                    </button>
                  );
                })}
              </div>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className="mt-3 w-full resize-none rounded-lg border border-line bg-card p-3 font-mono text-[12px] leading-5 text-ink-2 focus:border-brand/50 focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={send}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"
              >
                <Send className="h-3.5 w-3.5" /> Send via {channel}
              </button>
              <button
                type="button"
                onClick={escalate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-medium text-warning-strong transition-colors hover:border-warning/50 hover:bg-warning-soft"
              >
                <ShieldAlert className="h-3.5 w-3.5" /> Escalate
              </button>
            </div>
          </motion.section>

          {/* Reminder history */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.18, ease: 'easeOut' }}
          >
            <h3 className="text-caption">Reminder history</h3>
            <ol className="mt-3 space-y-0 border-l border-line pl-4">
              {history.map((r, i) => (
                <li key={`${r.sentAt}-${i}`} className="relative pb-4 last:pb-0">
                  <span
                    className={cn(
                      'absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card',
                      i === 0 ? 'bg-brand' : 'bg-ink-3/50',
                    )}
                  />
                  <div className="text-[12px] font-medium text-ink">
                    {r.channel} reminder {i === 0 ? '· latest' : ''}
                  </div>
                  <div className="text-[11px] text-ink-3">
                    {fmtDateTime(r.sentAt)} · by {r.by}
                  </div>
                </li>
              ))}
            </ol>
          </motion.section>
        </div>
      )}
    </Drawer>
  );
}
