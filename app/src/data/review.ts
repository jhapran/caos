import { CLIENTS } from './clients';
import type { ReviewItem, ReviewType } from './types';

// 21 review items = 6 GST reconciliations + 5 TDS + 4 ITR + 3 Financial Statements + 3 audit workpapers
const PLAN: { type: ReviewType; count: number; titles: string[] }[] = [
  {
    type: 'GST Reconciliation', count: 6,
    titles: ['GSTR-2A vs purchase register reco', 'GSTR-1 vs books reco', 'ITC eligibility review', 'R1 vs R3B outward liability match', 'Credit note reconciliation', 'E-invoice vs GSTR-1 tie-out'],
  },
  {
    type: 'TDS', count: 5,
    titles: ['TDS 26Q deduction mapping', 'TDS on rent — rate check', '194C contractor ledger review', 'TDS challan vs 26AS match', 'Lower deduction certificate application'],
  },
  {
    type: 'ITR', count: 4,
    titles: ['ITR-6 computation review', 'Capital gains working review', 'MAT computation check', 'Loss & depreciation schedules'],
  },
  {
    type: 'Financial Statements', count: 3,
    titles: ['Draft BS & P&L review', 'Notes to accounts — related party', 'Cash flow statement tie-out'],
  },
  {
    type: 'Audit Workpaper', count: 3,
    titles: ['Fixed assets verification wp', 'Debtors confirmation wp', 'Statutory dues wp'],
  },
];

const SUBMITTERS = ['u-priya', 'u-rahul', 'u-neha', 'u-amit'];
const PRIORITIES: ReviewItem['priority'][] = ['high', 'medium', 'low'];
const NOTES = [
  'Ready for partner sign-off. All schedules cross-checked against ledger.',
  'Variance of ₹42,180 identified and explained in attached working.',
  'Client has confirmed the figures over email on 06 Sep.',
  'Prepared per checklist; two open queries flagged in comments.',
  'Recomputed after client shared revised purchase register.',
  'Pending only the manager checklist sign-off.',
];

function build(): ReviewItem[] {
  const items: ReviewItem[] = [];
  let n = 0;
  const base = new Date('2025-09-08T17:30:00+05:30').getTime();
  for (const { type, count, titles } of PLAN) {
    for (let i = 0; i < count; i++) {
      n += 1;
      const client = CLIENTS[(n * 5 + i) % CLIENTS.length];
      const submittedBy = SUBMITTERS[n % SUBMITTERS.length];
      items.push({
        id: `r-${String(n).padStart(2, '0')}`,
        type,
        clientId: client.id,
        title: titles[i],
        period: type === 'GST Reconciliation' ? 'Aug 2025' : type === 'TDS' ? 'Q2 FY26' : 'FY 2024-25',
        submittedBy,
        submittedAt: new Date(base - n * 5 * 3600000).toISOString(),
        status: 'pending',
        priority: PRIORITIES[n % 3],
        note: NOTES[n % NOTES.length],
        comments: [
          { at: new Date(base - n * 5 * 3600000 + 3600000).toISOString(), by: 'Priya Nair', text: 'First-level check complete.' },
        ],
      });
    }
  }
  return items;
}

export const REVIEW_ITEMS: ReviewItem[] = build();

export const REVIEW_COUNTS = {
  total: REVIEW_ITEMS.length, // 21
  gst: REVIEW_ITEMS.filter((r) => r.type === 'GST Reconciliation').length, // 6
  tds: REVIEW_ITEMS.filter((r) => r.type === 'TDS').length, // 5
  itr: REVIEW_ITEMS.filter((r) => r.type === 'ITR').length, // 4
  fs: REVIEW_ITEMS.filter((r) => r.type === 'Financial Statements').length, // 3
  workpapers: REVIEW_ITEMS.filter((r) => r.type === 'Audit Workpaper').length, // 3
};
