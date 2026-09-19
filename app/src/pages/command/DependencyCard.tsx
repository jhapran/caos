import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BellRing, Check } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { getDataSource, useDemoStore, useLiveAggregates } from '@/data';
import type { ClientDependencyRecord } from '@/data';
import { useClientDependencies } from '@/hooks/useDeadlineData';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/**
 * Section C — Client Dependency. Top blockers with one-click nudges
 * (toast via the demo store); banner reconciles with DEPENDENCY_TOTALS.
 *
 * IMP-060 (H7): in live (Supabase) mode the card reads the IMP-051
 * client_dependency board through useClientDependencies — truthful client
 * counts only; the Nudge affordance and the /dependency "See all" link are
 * demo-only (the standalone page stays gated).
 */
export default function DependencyCard({ delay = 0 }: { delay?: number }) {
  if (getDataSource() !== 'supabase') return <FixtureDependencyCard delay={delay} />;
  return <LiveDependencyCard delay={delay} />;
}

/** Fixture/demo track — unchanged. */
function FixtureDependencyCard({ delay }: { delay: number }) {
  const { dependencyClients, sendReminder } = useDemoStore();
  const agg = useLiveAggregates();
  const [nudged, setNudged] = useState<Record<string, boolean>>({});

  const top = [...dependencyClients].sort((a, b) => b.blockingTasks - a.blockingTasks).slice(0, 3);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Client Dependency"
      className="rounded-xl border border-line bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">Client Dependency</h2>
        <Link
          to="/dependency"
          className="gold-underline-sweep flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-deep"
        >
          See all {agg.dependencyClients} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="px-5 pt-1.5 text-[14px] leading-5 font-semibold text-warning-strong">
        {agg.dependencyClients} clients currently blocking {agg.dependencyTasks} compliance tasks.
      </p>
      <p className="px-5 text-[12px] leading-4 text-ink-3">Documents requested but not received.</p>

      <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
        {top.map((c, i) => (
          <motion.li
            key={c.clientId}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: delay + 0.15 + i * 0.08, ease: EASE }}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-soft/40"
          >
            <Avatar name={c.clientName} size="sm" />
            <div className="min-w-0 flex-1">
              <Link
                to={`/dependency?client=${c.clientId}`}
                className="block truncate text-[13.5px] leading-5 font-semibold text-ink hover:text-brand"
              >
                {c.clientName}
              </Link>
              <span className="block text-[12px] leading-4 text-ink-3">
                {c.blockingTasks} missing items · oldest request {c.oldestWaitDays} days ago
              </span>
            </div>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-warning-soft px-1.5 font-mono text-[12px] font-semibold text-warning-strong tnum">
              {c.blockingTasks}
            </span>
            <button
              type="button"
              disabled={nudged[c.clientId]}
              onClick={() => {
                sendReminder(c.clientId);
                setNudged((s) => ({ ...s, [c.clientId]: true }));
              }}
              className={cn(
                'flex w-[76px] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all',
                nudged[c.clientId]
                  ? 'border-success/40 bg-success-soft text-success'
                  : 'border-line bg-card text-ink-2 hover:border-brand/40 hover:text-brand',
              )}
            >
              {nudged[c.clientId] ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Sent
                </>
              ) : (
                <>
                  <BellRing className="h-3.5 w-3.5" /> Nudge
                </>
              )}
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.section>
  );
}

/** Per-client roll-up of the live client-dependency board rows. */
interface ClientRollup {
  clientId: string;
  clientName: string;
  openItems: number;
  oldestAgeDays: number;
}

/** Live (Supabase) track — the IMP-051 client_dependency board behind
 *  useClientDependencies. */
function LiveDependencyCard({ delay }: { delay: number }) {
  const { data, loading, error, refetch } = useClientDependencies();

  const rollups = useMemo<ClientRollup[]>(() => {
    if (!data) return [];
    const byClient = new Map<string, ClientRollup>();
    for (const row of data as ClientDependencyRecord[]) {
      const existing = byClient.get(row.clientId);
      if (existing) {
        existing.openItems += 1;
        existing.oldestAgeDays = Math.max(existing.oldestAgeDays, row.ageDays);
      } else {
        byClient.set(row.clientId, {
          clientId: row.clientId,
          clientName: row.clientName ?? '—',
          openItems: 1,
          oldestAgeDays: row.ageDays,
        });
      }
    }
    // Top blockers: most open items, then the oldest wait.
    return [...byClient.values()]
      .sort((a, b) => b.openItems - a.openItems || b.oldestAgeDays - a.oldestAgeDays)
      .slice(0, 3);
  }, [data]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      aria-label="Client Dependency"
      className="rounded-xl border border-line bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">Client Dependency</h2>
      </div>

      {loading ? (
        <div className="m-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-[14px] font-medium text-ink">Loading…</p>
          <p className="mt-1 text-[13px] text-ink-3">Reading the live client-dependency board.</p>
        </div>
      ) : error ? (
        <div className="m-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <p className="text-[14px] font-medium text-ink">Could not load client dependencies</p>
          <p className="mt-1 text-[13px] text-ink-3">{error.message}</p>
          <button
            type="button"
            onClick={refetch}
            className="mt-4 rounded-lg border border-line bg-card px-4 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
          >
            Retry
          </button>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="m-5 rounded-xl border border-dashed border-line px-6 py-10 text-center text-[13px] text-ink-3">
          No client dependencies — nothing is waiting on clients right now.
        </p>
      ) : (
        <>
          <p className="px-5 pt-1.5 text-[14px] leading-5 font-semibold text-warning-strong">
            {new Set(data.map((r) => r.clientId)).size} clients · {data.length} open dependency items
          </p>
          <p className="px-5 text-[12px] leading-4 text-ink-3">
            Instances awaiting client information or tasks waiting on the client.
          </p>

          <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
            {rollups.map((c, i) => (
              <motion.li
                key={c.clientId}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: delay + 0.15 + i * 0.08, ease: EASE }}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-soft/40"
              >
                <Avatar name={c.clientName} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/clients/${c.clientId}`}
                    className="block truncate text-[13.5px] leading-5 font-semibold text-ink hover:text-brand"
                  >
                    {c.clientName}
                  </Link>
                  <span className="block text-[12px] leading-4 text-ink-3">
                    {c.openItems} open {c.openItems === 1 ? 'item' : 'items'} · oldest {c.oldestAgeDays} days ago
                  </span>
                </div>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-warning-soft px-1.5 font-mono text-[12px] font-semibold text-warning-strong tnum">
                  {c.openItems}
                </span>
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </motion.section>
  );
}
