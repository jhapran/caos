// Ask CAOS: 6 pre-authored question → structured answer fixtures + fallback (design.md §8)

import type { AskAnswer } from './types';

export const ASK_FIXTURES: AskAnswer[] = [
  {
    question: 'Which GSTR-3B filings are due this week?',
    summary: '5 GSTR-3B filings fall due by 20 Sep 2025. 2 are ready to file, 2 are in preparation, and 1 is waiting on the client purchase register.',
    chips: [
      { label: 'Compliance', value: 'GSTR-3B' },
      { label: 'Due window', value: 'This week (≤ 20 Sep)' },
      { label: 'Status', value: 'Not filed' },
    ],
    table: {
      columns: ['Client', 'Period', 'Due', 'Status', 'Owner'],
      rows: [
        ['ABC Pvt Ltd', 'Aug 2025', '20 Sep 2025', 'Waiting for Client', 'Priya Nair'],
        ['Trident Pharma Pvt Ltd', 'Aug 2025', '20 Sep 2025', 'Ready to File', 'Priya Nair'],
        ['Vedant Alloys Pvt Ltd', 'Aug 2025', '20 Sep 2025', 'Preparation', 'Rahul Verma'],
        ['LMN Ltd', 'Aug 2025', '20 Sep 2025', 'Ready to File', 'CA Pranav Kumar'],
        ['Kaveri Textiles Pvt Ltd', 'Aug 2025', '20 Sep 2025', 'Preparation', 'Rahul Verma'],
      ],
    },
    followUps: ['Which of these have all documents received?', 'Draft reminder for ABC Pvt Ltd', 'Show ABC Pvt Ltd risk score breakdown'],
  },
  {
    question: 'Show me clients blocking the most work',
    summary: '48 clients are currently blocking 79 tasks. ABC Pvt Ltd alone blocks 7 tasks — the oldest waiting item is 12 days old.',
    chips: [
      { label: 'Segment', value: 'Client dependency' },
      { label: 'Sort', value: 'Blocked tasks desc' },
    ],
    table: {
      columns: ['Client', 'Blocked tasks', 'Oldest wait', 'Missing documents', 'Owner'],
      rows: [
        ['ABC Pvt Ltd', '7', '12 days', 'Bank statements (Aug), Purchase register, TDS challans', 'Priya Nair'],
        ['XYZ LLP', '5', '9 days', 'Sales register, 26AS statement', 'Rahul Verma'],
        ['PQR Industries', '4', '8 days', 'Trial balance, Fixed asset register', 'Priya Nair'],
        ['Crestpoint Realty LLP', '2', '7 days', 'Rent agreements', 'Priya Nair'],
        ['Vedant Alloys Pvt Ltd', '2', '6 days', 'Salary register', 'Rahul Verma'],
      ],
    },
    followUps: ['Send reminder to ABC Pvt Ltd', 'Which blocked tasks are due this week?', 'Escalate ABC Pvt Ltd to CFO'],
  },
  {
    question: 'What is ABC Pvt Ltd’s risk score and why?',
    summary: 'ABC Pvt Ltd carries a risk score of 82/100 — driven by an overdue GSTR-1, 7 blocked tasks, and unanswered information requests since 28 Aug.',
    chips: [
      { label: 'Client', value: 'ABC Pvt Ltd' },
      { label: 'Explainability', value: 'Risk factor breakdown' },
    ],
    table: {
      columns: ['Factor', 'Points', 'Detail'],
      rows: [
        ['Work not started (2 tasks)', '40', 'No preparation activity recorded'],
        ['Overdue items', '28', 'GSTR-1 Aug 2025 overdue; due date proximity on 3 more'],
        ['Documents missing', '12', '3 documents pending after 2 reminders'],
        ['Total', '82', 'Firm threshold for “critical” is 70'],
      ],
    },
    followUps: ['List ABC Pvt Ltd overdue items', 'Draft escalation email to ABC Pvt Ltd', 'Compare with last month'],
  },
  {
    question: 'Which returns can we file today?',
    summary: '9 returns are in “Ready to File” state with partner approval complete. Filing all 9 today clears 41% of this week’s due volume.',
    chips: [
      { label: 'Status', value: 'Ready to File' },
      { label: 'Approval', value: 'Complete' },
    ],
    table: {
      columns: ['Client', 'Compliance', 'Period', 'Due', 'Owner'],
      rows: [
        ['Trident Pharma Pvt Ltd', 'GSTR-3B', 'Aug 2025', '20 Sep 2025', 'Priya Nair'],
        ['LMN Ltd', 'GSTR-3B', 'Aug 2025', '20 Sep 2025', 'CA Pranav Kumar'],
        ['Sapphire Software Solutions', 'GSTR-1', 'Aug 2025', '11 Sep 2025', 'Rahul Verma'],
        ['Astra Cloud Technologies', 'GSTR-1', 'Aug 2025', '11 Sep 2025', 'Rahul Verma'],
        ['Quickmed Diagnostics Pvt Ltd', 'GSTR-1', 'Aug 2025', '11 Sep 2025', 'Priya Nair'],
      ],
    },
    followUps: ['Mark these as filed', 'Show ready-to-file TDS returns', 'Any filings blocked by review?'],
  },
  {
    question: 'Summarise this week’s risk alerts',
    summary: '5 active alerts: 2 critical (overdue GSTR-1 cluster, tax-audit deadline crunch), 1 high (ABC dependency), 1 medium (advance tax), 1 low (MCA season prep).',
    chips: [
      { label: 'Segment', value: 'Risk alerts' },
      { label: 'Window', value: 'This week' },
    ],
    table: {
      columns: ['Severity', 'Alert', 'Owner', 'Recommended action'],
      rows: [
        ['Critical', 'GSTR-1 overdue for 3 clients', 'Priya Nair', 'Escalation reminder + reassign prep'],
        ['Critical', '9 tax audits due 30 Sep', 'CA Pranav Kumar', 'Rebalance workload across team'],
        ['High', 'ABC Pvt Ltd blocking 7 tasks', 'Priya Nair', 'Escalate to client CFO'],
        ['Medium', 'Advance Tax Q2 due 15 Sep (6 clients)', 'Rahul Verma', 'Send challan-ready computations'],
        ['Low', 'MCA annual filings season starting', 'Neha Iyer', 'Schedule 5 AGMs before 25 Sep'],
      ],
    },
    followUps: ['Open the critical GSTR-1 alert', 'Who has capacity to take 2 audits?', 'Show alert history'],
  },
  {
    question: 'How is the team loaded this month?',
    summary: 'Priya Nair carries the heaviest load (312 active tasks incl. the ABC dependency). Amit Shah has headroom — moving 2 tax audits to him protects the 30 Sep deadline.',
    chips: [
      { label: 'Segment', value: 'Team capacity' },
      { label: 'Period', value: 'Sep 2025' },
    ],
    table: {
      columns: ['Team member', 'Active tasks', 'Due ≤ 15 days', 'At risk', 'Load'],
      rows: [
        ['Priya Nair', '312', '64', '7', 'Heavy'],
        ['Rahul Verma', '288', '52', '4', 'Heavy'],
        ['Neha Iyer', '226', '38', '2', 'Moderate'],
        ['Amit Shah', '214', '31', '2', 'Moderate'],
        ['CA Pranav Kumar', '128', '18', '1', 'Reviews only'],
      ],
    },
    followUps: ['Reassign 2 audits to Amit Shah', 'Show Priya Nair’s at-risk items', 'Export workload report'],
  },
];

export const FALLBACK_ANSWER: Omit<AskAnswer, 'question'> = {
  summary:
    'I interpreted your question against the firm’s live compliance graph. Here is the closest matching cut — refine by naming a client, compliance, or due window.',
  chips: [
    { label: 'Interpretation', value: 'Best-effort match' },
    { label: 'Scope', value: 'All clients · Sep 2025' },
  ],
  table: {
    columns: ['Client', 'Compliance', 'Due', 'Status', 'Owner'],
    rows: [
      ['ABC Pvt Ltd', 'GSTR-1', '11 Sep 2025', 'Not Started', 'Priya Nair'],
      ['PQR Industries', 'Tax Audit', '30 Sep 2025', 'Preparation', 'Priya Nair'],
      ['LMN Ltd', 'Advance Tax', '15 Sep 2025', 'Waiting for Client', 'CA Pranav Kumar'],
      ['Vedant Alloys Pvt Ltd', 'GSTR-3B', '20 Sep 2025', 'Preparation', 'Rahul Verma'],
    ],
  },
  followUps: [
    'Which GSTR-3B filings are due this week?',
    'Show me clients blocking the most work',
    'Which returns can we file today?',
  ],
};

export const SUGGESTED_QUESTIONS = ASK_FIXTURES.map((f) => f.question);

function normalise(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Match a free-text query to a canned fixture (token overlap), else fallback. */
export function matchAskQuery(query: string): AskAnswer {
  const tokens = new Set(normalise(query).split(' ').filter((t) => t.length > 2));
  let best: AskAnswer | null = null;
  let bestScore = 0;
  for (const f of ASK_FIXTURES) {
    const fTokens = normalise(f.question).split(' ');
    const score = fTokens.filter((t) => tokens.has(t)).length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  if (best && bestScore >= 3) return best;
  return { question: query, ...FALLBACK_ANSWER };
}
