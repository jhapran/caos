import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ArrowRight, BadgeCheck, TriangleAlert } from 'lucide-react';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Drawer from '@/components/Drawer';
import { DEMO_TODAY, getClient, getCompliance, ownerOf, useDemoStore } from '@/data';
import type { AlertSeverity, FirmAlert } from '@/data';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_DOT: Record<AlertSeverity, string> = {
  critical: 'bg-critical',
  high: 'bg-warning',
  medium: 'bg-gold',
  low: 'bg-ink-3',
};
const SEVERITY_CHIP: Record<AlertSeverity, string> = {
  critical: 'bg-critical-soft text-critical',
  high: 'bg-warning-soft text-warning-strong',
  medium: 'bg-gold-soft text-gold',
  low: 'bg-paper-deep text-ink-2',
};

/** Relative time against the frozen demo clock (09 Sep 2025, 09:30 IST). */
function timeAgo(iso: string): string {
  const diffMs = DEMO_TODAY.getTime() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Section E — Firm Risk Alerts. Severity-triaged rows; clicking opens the
 * detail Drawer (affected entities, recommended action, resolve CTA).
 */
export default function RiskAlertsCard({ delay = 0 }: { delay?: number }) {
  const { alerts, activeAlertCount, resolveAlert } = useDemoStore();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<FirmAlert | null>(null);

  const shown = useMemo(
    () =>
      [...alerts]
        .filter((a) => a.status !== 'resolved')
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.raisedAt.localeCompare(a.raisedAt)),
    [alerts],
  );

  const selectedClient = selected?.clientId ? getClient(selected.clientId) : undefined;
  const selectedCompliance = selected?.complianceId ? getCompliance(selected.complianceId) : undefined;
  const selectedOwner = selected ? ownerOf(selected.ownerId) : undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Firm Risk Alerts"
      className="rounded-xl border border-line border-l-[3px] border-l-critical bg-card shadow-card"
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] leading-6 font-semibold text-ink">Firm Risk Alerts</h2>
          <Badge tone="critical">{activeAlertCount} active</Badge>
        </div>
        <Link
          to="/alerts"
          className="gold-underline-sweep flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-deep"
        >
          View all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ul className="mt-2 divide-y divide-line/70">
        {shown.map((alert, i) => (
          <motion.li
            key={alert.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: delay + 0.15 + i * 0.07, ease: EASE }}
          >
            <button
              type="button"
              onClick={() => setSelected(alert)}
              className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-brand-soft/40"
            >
              <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
                {alert.severity === 'critical' && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical opacity-60" />
                )}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', SEVERITY_DOT[alert.severity])} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[13px] leading-5 text-ink', alert.status === 'acknowledged' ? 'font-medium opacity-70' : 'font-semibold')}>
                  {alert.title}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-4 text-ink-3">
                  {timeAgo(alert.raisedAt)} · {ownerOf(alert.ownerId).name}
                </span>
              </span>
              <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-3" />
            </button>
          </motion.li>
        ))}
      </ul>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title}
        subtitle={selected ? `Raised ${format(parseISO(selected.raisedAt), 'd MMM yyyy, h:mm a')} · ${timeAgo(selected.raisedAt)}` : undefined}
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-4 font-medium', SEVERITY_CHIP[selected.severity])}>
                <TriangleAlert className="h-3.5 w-3.5" />
                {selected.severity.charAt(0).toUpperCase() + selected.severity.slice(1)} severity
              </span>
              <span className="rounded-full bg-paper-deep px-2.5 py-1 text-[11px] leading-4 font-medium text-ink-2 capitalize">
                {selected.status}
              </span>
            </div>

            <p className="text-[13.5px] leading-6 text-ink-2">{selected.detail}</p>

            {/* Affected entities */}
            {(selectedClient || selectedCompliance || selectedOwner) && (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[12.5px] leading-5">
                  <tbody>
                    {selectedClient && (
                      <tr className="border-b border-line/60">
                        <td className="bg-paper-deep/70 px-3 py-2 text-caption">Client</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-ink">{selectedClient.name}</span>
                          {selectedClient.gstin && (
                            <span className="block font-mono text-[11px] text-ink-3 tnum">GSTIN {selectedClient.gstin}</span>
                          )}
                        </td>
                      </tr>
                    )}
                    {selectedCompliance && (
                      <tr className="border-b border-line/60">
                        <td className="bg-paper-deep/70 px-3 py-2 text-caption">Compliance</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-ink">{selectedCompliance.name}</span>
                          <span className="block text-[11px] text-ink-3">Due rule: {selectedCompliance.dueRule}</span>
                        </td>
                      </tr>
                    )}
                    {selectedOwner && (
                      <tr>
                        <td className="bg-paper-deep/70 px-3 py-2 text-caption">Owner</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <Avatar name={selectedOwner.name} size="xs" />
                            <span className="font-medium text-ink">{selectedOwner.name}</span>
                            <span className="text-[11px] text-ink-3">{selectedOwner.role}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recommended action */}
            <div className="rounded-lg border border-brand/20 bg-brand-soft/60 px-4 py-3">
              <p className="text-caption text-brand">Recommended action</p>
              <p className="mt-1 text-[13px] leading-5 text-ink">{selected.recommendedAction}</p>
            </div>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  navigate('/alerts');
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-deep"
              >
                Open in Alerts <ArrowRight className="h-3.5 w-3.5" />
              </button>
              {selected.status === 'active' && (
                <button
                  type="button"
                  onClick={() => {
                    resolveAlert(selected.id);
                    setSelected(null);
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-success/50 hover:text-success"
                >
                  <BadgeCheck className="h-4 w-4" /> Mark resolved
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </motion.section>
  );
}
