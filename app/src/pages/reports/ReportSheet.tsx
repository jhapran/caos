import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { AGGREGATES, DEPENDENCY_CLIENTS, FIRM, getDeadlineGroups, REVIEW_COUNTS } from '@/data';
import DeadlineRing from '@/components/DeadlineRing';
import { cn } from '@/lib/utils';
import { averageWait } from '../dependency/dependencyModel';

const fmtIn = (n: number) => n.toLocaleString('en-IN');

const STATUS_ROWS: { label: string; value: number; bar: string; text: string }[] = [
  { label: 'Completed / filed', value: AGGREGATES.completed, bar: 'bg-success', text: 'text-success' },
  { label: 'In progress', value: AGGREGATES.inProgress, bar: 'bg-info', text: 'text-info' },
  { label: 'Waiting for client', value: AGGREGATES.waiting, bar: 'bg-warning', text: 'text-warning-strong' },
  { label: 'Under review', value: AGGREGATES.underReview, bar: 'bg-violet', text: 'text-violet' },
  { label: 'At risk / not started', value: AGGREGATES.atRisk, bar: 'bg-critical', text: 'text-critical' },
];

const EXCEPTIONS: { client: string; reason: string; owner: string }[] = [
  { client: 'ABC Pvt Ltd', reason: 'GSTR-3B blocked — GSTR-2A reco + bank statements pending 12 days', owner: 'Priya Nair' },
  { client: 'PQR Industries', reason: 'Tax audit TB tie-out waiting on trial balance; DSC expires in 9 days', owner: 'Priya Nair' },
  { client: 'XYZ LLP', reason: 'TDS 26Q preparation stalled — Form 16A and challans missing', owner: 'Rahul Verma' },
  { client: 'RST Pvt Ltd', reason: 'Receivable ₹1.2 L at 118 days; engagement letter unsigned', owner: 'CA Lew Kong' },
  { client: 'LMN Ltd', reason: 'Advance tax Q2 computation unconfirmed — estimated income not shared', owner: 'Rahul Verma' },
];

const block = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay: 0.15 + i * 0.1, ease: 'easeOut' as const },
});

/** The "print artifact" — board-ready compliance & deadline snapshot. */
export default function ReportSheet({ mode }: { mode: 'status' | 'deadlines' }) {
  const navigate = useNavigate();
  const groups = getDeadlineGroups().filter((g) => g.daysLeft >= 0).slice(0, 10);
  const total = AGGREGATES.active;
  const avgWait = averageWait(DEPENDENCY_CLIENTS);

  return (
    <div className="reports-sheet mx-auto w-full max-w-[880px] rounded-xl border border-line bg-card shadow-card">
      {/* Masthead */}
      <motion.div {...block(0)} className="px-8 pt-7">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="CAOS" className="h-7 w-auto" />
          <div className="h-8 w-px bg-line" />
          <div>
            <div className="font-display text-[18px] leading-6 font-medium text-ink">{FIRM.name}</div>
            <div className="font-mono text-[11px] text-ink-3">
              Firm Compliance Snapshot · {FIRM.fy} · Generated 09 Sep 2025, 09:12 IST
            </div>
          </div>
          <div className="ml-auto text-right font-mono text-[11px] text-ink-3">
            FRN {FIRM.frn}
            <br />
            {FIRM.city}
          </div>
        </div>
        <div className="mt-5 h-px w-full bg-gold/70" />
      </motion.div>

      {mode === 'status' ? (
        <div key="status">
          {/* Compliance status summary */}
          <motion.section {...block(1)} className="px-8 pt-6">
            <h2 className="text-caption">Compliance status — all active obligations</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-line">
              <table className="w-full text-[13px] leading-5">
                <tbody>
                  {STATUS_ROWS.map((r, i) => (
                    <tr key={r.label} className={cn('border-b border-line/60 last:border-b-0', i % 2 === 1 && 'bg-paper-deep/50')}>
                      <td className="px-4 py-2.5 text-ink-2">{r.label}</td>
                      <td className={cn('px-4 py-2.5 text-right font-mono font-semibold tnum', r.text)}>{fmtIn(r.value)}</td>
                      <td className="w-24 px-4 py-2.5 text-right font-mono text-[12px] text-ink-3 tnum">
                        {((r.value / total) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-paper-deep/70">
                    <td className="px-4 py-2.5 font-semibold text-ink">Total active tasks</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-ink tnum">{fmtIn(total)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-ink-3 tnum">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Segmented bar */}
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full">
              {STATUS_ROWS.map((r, i) => (
                <motion.div
                  key={r.label}
                  className={cn('h-full', r.bar)}
                  initial={{ flexGrow: 0 }}
                  animate={{ flexGrow: r.value }}
                  transition={{ duration: 0.8, delay: 0.35 + i * 0.05, ease: 'easeOut' }}
                  style={{ flexBasis: 0 }}
                  title={`${r.label}: ${fmtIn(r.value)}`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {STATUS_ROWS.map((r) => (
                <span key={r.label} className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
                  <span className={cn('h-2 w-2 rounded-full', r.bar)} />
                  {r.label} <span className="font-mono tnum">{fmtIn(r.value)}</span>
                </span>
              ))}
            </div>
          </motion.section>

          {/* Upcoming deadlines */}
          <motion.section {...block(2)} className="px-8 pt-6">
            <h2 className="text-caption">Upcoming deadlines</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-line">
              <table className="w-full text-[12px] leading-5">
                <thead>
                  <tr className="bg-paper-deep/70 text-left">
                    <th className="px-4 py-2 text-caption">Compliance</th>
                    <th className="px-4 py-2 text-caption">Due</th>
                    <th className="px-4 py-2 text-right text-caption">Clients</th>
                    <th className="px-4 py-2 text-right text-caption">Ready</th>
                    <th className="px-4 py-2 text-right text-caption">Blocked</th>
                    <th className="px-4 py-2 text-right text-caption">At risk</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => (
                    <tr
                      key={g.id}
                      onClick={() => navigate(`/deadlines/${encodeURIComponent(g.id)}/clients`)}
                      className={cn(
                        'cursor-pointer border-b border-line/60 transition-colors last:border-b-0 hover:bg-brand-soft/40',
                        i % 2 === 1 && 'bg-paper-deep/50',
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-ink">{g.complianceName}</span>
                        <span className="ml-2 text-[11px] text-ink-3">{g.period}</span>
                      </td>
                      <td className="px-4 py-2.5 text-ink-2">
                        {format(new Date(g.dueDate), 'dd MMM')}
                        <span
                          className={cn(
                            'ml-1.5 font-mono text-[11px] tnum',
                            g.daysLeft <= 7 ? 'text-critical' : g.daysLeft <= 14 ? 'text-warning-strong' : 'text-ink-3',
                          )}
                        >
                          ({g.daysLeft}d)
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tnum text-ink">{g.totalClients}</td>
                      <td className="px-4 py-2.5 text-right font-mono tnum text-success">{g.readyToFile + g.filed}</td>
                      <td className="px-4 py-2.5 text-right font-mono tnum text-warning-strong">{g.waiting}</td>
                      <td className="px-4 py-2.5 text-right font-mono tnum text-critical">{g.atRisk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.section>

          {/* Operational pulse */}
          <motion.section {...block(3)} className="px-8 pt-6">
            <h2 className="text-caption">Operational pulse</h2>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-line px-4 py-3">
                <div className="font-mono text-[18px] font-semibold text-info tnum">{REVIEW_COUNTS.total}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-ink-3">items in review queue · median turnaround 1.8 days</div>
              </div>
              <div className="rounded-lg border border-line px-4 py-3">
                <div className="font-mono text-[18px] font-semibold text-warning-strong tnum">{DEPENDENCY_CLIENTS.length}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-ink-3">
                  clients blocking work · avg wait {avgWait.toFixed(1)} days
                </div>
              </div>
              <div className="rounded-lg border border-line px-4 py-3">
                <div className="font-mono text-[18px] font-semibold text-critical tnum">5</div>
                <div className="mt-0.5 text-[11px] leading-4 text-ink-3">active firm risk alerts · 1 critical</div>
              </div>
            </div>
          </motion.section>

          {/* Exceptions */}
          <motion.section {...block(4)} className="px-8 pt-6 pb-2">
            <h2 className="text-caption">Exceptions &amp; attention items</h2>
            <ol className="mt-3 space-y-2.5">
              {EXCEPTIONS.map((e, i) => (
                <li key={e.client} className="flex items-start gap-3 text-[13px] leading-5">
                  <span className="mt-0.5 font-display text-[14px] font-medium text-gold tnum">{i + 1}.</span>
                  <span>
                    <span className="font-semibold text-ink">{e.client}</span>
                    <span className="text-ink-2"> — {e.reason}.</span>
                    <span className="ml-1.5 text-[11px] font-medium text-ink-3">Owner: {e.owner}</span>
                  </span>
                </li>
              ))}
            </ol>
          </motion.section>
        </div>
      ) : (
        <div key="deadlines">
          {/* Deadlines-centric layout: timeline + coverage bars */}
          <motion.section {...block(1)} className="px-8 pt-6 pb-2">
            <h2 className="text-caption">Upcoming deadlines — coverage by compliance</h2>
            <div className="mt-4 space-y-4">
              {groups.map((g) => {
                const covered = g.filed + g.readyToFile;
                const pct = Math.round((covered / g.totalClients) * 100);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => navigate(`/deadlines/${encodeURIComponent(g.id)}/clients`)}
                    className="flex w-full items-center gap-4 rounded-lg border border-line px-4 py-3 text-left transition-colors hover:bg-brand-soft/40"
                  >
                    <DeadlineRing daysLeft={g.daysLeft} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ink">
                          {g.complianceName} <span className="font-normal text-ink-3">· {g.period}</span>
                        </span>
                        <span className="font-mono text-[11px] text-ink-3 tnum">
                          due {format(new Date(g.dueDate), 'dd MMM')}
                        </span>
                      </div>
                      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-paper-deep">
                        <motion.div
                          className="h-full bg-success"
                          initial={{ width: 0 }}
                          animate={{ width: `${(g.filed / g.totalClients) * 100}%` }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                        />
                        <motion.div
                          className="h-full bg-brand"
                          initial={{ width: 0 }}
                          animate={{ width: `${(g.readyToFile / g.totalClients) * 100}%` }}
                          transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-ink-3">
                        <span className="font-mono tnum">{covered}/{g.totalClients}</span> ready or filed ·{' '}
                        <span className="font-mono tnum">{pct}%</span> coverage ·{' '}
                        <span className="text-warning-strong">{g.waiting} blocked</span>
                        {g.atRisk > 0 && <span className="text-critical"> · {g.atRisk} at risk</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.section>
        </div>
      )}

      {/* Footer */}
      <motion.div {...block(5)} className="mt-6 border-t border-line px-8 py-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">
            Prepared by CAOS · Explainable data — every figure drills to source in the app
          </span>
          <span className="font-mono text-[11px] text-ink-3 tnum">1 / 1</span>
        </div>
      </motion.div>
    </div>
  );
}
