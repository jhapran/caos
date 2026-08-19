// Timeline view for the deadlines board — month lanes (Sep / Oct / Nov) with
// deadline markers on a hairline rail. Dots scale in staggered; rail draws L→R.
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { DEMO_TODAY } from '@/data';
import type { DeadlineGroup } from '@/data';
import { fmtDate, groupReady } from './utils';
import { cn } from '@/lib/utils';

function dotColor(daysLeft: number): string {
  if (daysLeft < 0 || daysLeft <= 7) return '#C0362C';
  if (daysLeft <= 14) return '#C77414';
  return '#B7791F';
}

export default function TimelineView({
  groups,
  onOpen,
}: {
  groups: DeadlineGroup[];
  onOpen: (g: DeadlineGroup) => void;
}) {
  const lanes = useMemo(() => {
    const map = new Map<string, DeadlineGroup[]>();
    for (const g of [...groups].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      const key = format(new Date(g.dueDate), 'MMM yyyy');
      const arr = map.get(key) ?? [];
      arr.push(g);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [groups]);

  if (lanes.length === 0) return null;

  let dotIndex = 0;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
      <div className="border-b border-line px-5 py-3 text-[13px] font-medium text-ink-2">
        Statutory calendar — {lanes.map(([m]) => m.split(' ')[0]).join(' / ')}
      </div>
      <div className="divide-y divide-line/70">
        {lanes.map(([month, items]) => {
          const first = new Date(items[0].dueDate);
          const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
          const isCurrentMonth =
            DEMO_TODAY.getFullYear() === first.getFullYear() && DEMO_TODAY.getMonth() === first.getMonth();
          const todayPct = (DEMO_TODAY.getDate() / daysInMonth) * 100;
          return (
            <div key={month} className="flex items-center gap-4 px-5 py-5">
              <div className="w-24 shrink-0">
                <div className="text-[13px] font-semibold text-ink">{month}</div>
                <div className="text-[11px] text-ink-3 tnum">
                  {items.length} deadline{items.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="relative h-14 flex-1">
                {/* hairline rail draws left → right */}
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="absolute top-1/2 right-0 left-0 h-px origin-left bg-line"
                />
                {isCurrentMonth && (
                  <div className="absolute top-1 bottom-1" style={{ left: `${todayPct}%` }}>
                    <div className="h-full w-px bg-gold" />
                    <span className="absolute -top-1 left-1 font-mono text-[9px] tracking-wide text-gold uppercase">
                      Today
                    </span>
                  </div>
                )}
                {items.map((g) => {
                  const day = new Date(g.dueDate).getDate();
                  const left = ((day - 0.5) / daysInMonth) * 100;
                  const delay = 0.25 + dotIndex++ * 0.06;
                  return (
                    <div key={g.id} className="group absolute top-1/2 -translate-y-1/2" style={{ left: `${left}%` }}>
                      <motion.button
                        type="button"
                        aria-label={`${g.complianceName} · ${g.period} · due ${fmtDate(g.dueDate)}`}
                        onClick={() => onOpen(g)}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay, duration: 0.5, ease: 'backOut' }}
                        className="block h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-card shadow-card transition-transform hover:scale-125"
                        style={{ backgroundColor: dotColor(g.daysLeft) }}
                      />
                      {/* hover tooltip card */}
                      <div className="pointer-events-none absolute bottom-5 left-0 z-20 w-52 -translate-x-1/2 rounded-xl border border-line bg-card p-3 opacity-0 shadow-lift transition-opacity duration-150 group-hover:opacity-100">
                        <div className="text-[13px] font-semibold text-ink">
                          {g.complianceName} · {g.period}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-ink-3">Due {fmtDate(g.dueDate)}</div>
                        <div className="mt-2 flex gap-3 text-[11px] tnum">
                          <span className="text-ink-2">
                            <span className="font-semibold text-ink">{g.totalClients}</span> clients
                          </span>
                          <span className="text-warning-strong">
                            <span className="font-semibold">{g.waiting}</span> blocked
                          </span>
                          <span className="text-success">
                            <span className="font-semibold">{groupReady(g)}</span> ready
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 border-t border-line px-5 py-2.5 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full')} style={{ backgroundColor: '#C0362C' }} /> ≤ 7 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#C77414' }} /> 8–14 days
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#B7791F' }} /> 15+ days
        </span>
      </div>
    </div>
  );
}
