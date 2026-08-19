import type { ComplianceType, ComplianceId } from './types';

const MONTHLY_PERIODS = [
  'Aug 2024', 'Sep 2024', 'Oct 2024', 'Nov 2024', 'Dec 2024', 'Jan 2025',
  'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025', 'Jul 2025',
  'Aug 2025', 'Sep 2025',
];
const QUARTERLY_PERIODS = ['Q2 FY25', 'Q3 FY25', 'Q4 FY25', 'Q1 FY26', 'Q2 FY26'];
const ANNUAL_PERIODS = ['FY 2023-24', 'FY 2024-25'];

export const COMPLIANCE_MASTER: ComplianceType[] = [
  { id: 'gstr1', name: 'GSTR-1 (Outward Supplies)', shortName: 'GSTR-1', category: 'GST', frequency: 'Monthly', dueRule: '11th of following month', periods: MONTHLY_PERIODS },
  { id: 'gstr3b', name: 'GSTR-3B (Summary Return)', shortName: 'GSTR-3B', category: 'GST', frequency: 'Monthly', dueRule: '20th of following month', periods: MONTHLY_PERIODS },
  { id: 'tds24q', name: 'TDS Return 24Q (Salaries)', shortName: 'TDS 24Q', category: 'TDS', frequency: 'Quarterly', dueRule: '31st of month following quarter', periods: QUARTERLY_PERIODS },
  { id: 'tds26q', name: 'TDS Return 26Q (Non-salary)', shortName: 'TDS 26Q', category: 'TDS', frequency: 'Quarterly', dueRule: '31st of month following quarter', periods: QUARTERLY_PERIODS },
  { id: 'itr', name: 'Income Tax Return', shortName: 'ITR', category: 'Income Tax', frequency: 'Annual', dueRule: '31 Oct (audit) / 31 Jul (non-audit)', periods: ANNUAL_PERIODS },
  { id: 'tax-audit', name: 'Tax Audit (44AB)', shortName: 'Tax Audit', category: 'Audit', frequency: 'Annual', dueRule: '30 Sep following FY', periods: ANNUAL_PERIODS },
  { id: 'stat-audit', name: 'Statutory Audit', shortName: 'Stat Audit', category: 'Audit', frequency: 'Annual', dueRule: 'Within 6 months of FY end (AGM)', periods: ANNUAL_PERIODS },
  { id: 'mca-aoc4', name: 'MCA AOC-4 (Financial Statements)', shortName: 'AOC-4', category: 'MCA', frequency: 'Annual', dueRule: '30 days from AGM', periods: ANNUAL_PERIODS },
  { id: 'mca-mgt7', name: 'MCA MGT-7 (Annual Return)', shortName: 'MGT-7', category: 'MCA', frequency: 'Annual', dueRule: '60 days from AGM', periods: ANNUAL_PERIODS },
  { id: 'advance-tax', name: 'Advance Tax Instalment', shortName: 'Adv Tax', category: 'Income Tax', frequency: 'Quarterly', dueRule: '15 Jun / 15 Sep / 15 Dec / 15 Mar', periods: QUARTERLY_PERIODS },
  { id: 'pf-esi', name: 'PF / ESI Returns', shortName: 'PF/ESI', category: 'Payroll', frequency: 'Monthly', dueRule: '15th of following month', periods: MONTHLY_PERIODS },
];

export function getCompliance(id: ComplianceId): ComplianceType {
  const c = COMPLIANCE_MASTER.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown compliance ${id}`);
  return c;
}

const MONTH_DUE: Record<string, string> = {
  'Aug 2024': '2024-09', 'Sep 2024': '2024-10', 'Oct 2024': '2024-11',
  'Nov 2024': '2024-12', 'Dec 2024': '2025-01', 'Jan 2025': '2025-02',
  'Feb 2025': '2025-03', 'Mar 2025': '2025-04', 'Apr 2025': '2025-05',
  'May 2025': '2025-06', 'Jun 2025': '2025-07', 'Jul 2025': '2025-08',
  'Aug 2025': '2025-09', 'Sep 2025': '2025-10',
};

const TDS_DUE: Record<string, string> = {
  'Q2 FY25': '2024-10-31', 'Q3 FY25': '2025-01-31', 'Q4 FY25': '2025-05-31',
  'Q1 FY26': '2025-07-31', 'Q2 FY26': '2025-10-31',
};

const ADV_DUE: Record<string, string> = {
  'Q2 FY25': '2024-09-15', 'Q3 FY25': '2024-12-15', 'Q4 FY25': '2025-03-15',
  'Q1 FY26': '2025-06-15', 'Q2 FY26': '2025-09-15',
};

const ANNUAL_DUE: Partial<Record<ComplianceId, Record<string, string>>> = {
  'itr': { 'FY 2023-24': '2024-10-31', 'FY 2024-25': '2025-10-31' },
  'tax-audit': { 'FY 2023-24': '2024-09-30', 'FY 2024-25': '2025-09-30' },
  'stat-audit': { 'FY 2023-24': '2024-09-29', 'FY 2024-25': '2025-09-29' },
  'mca-aoc4': { 'FY 2023-24': '2024-10-29', 'FY 2024-25': '2025-10-29' },
  'mca-mgt7': { 'FY 2023-24': '2024-11-28', 'FY 2024-25': '2025-11-28' },
};

/** Statutory due date for a given compliance + period label (demo clock: 09 Sep 2025). */
export function dueDateFor(complianceId: ComplianceId, period: string): string {
  switch (complianceId) {
    case 'gstr1': return `${MONTH_DUE[period]}-11`;
    case 'gstr3b': return `${MONTH_DUE[period]}-20`;
    case 'pf-esi': return `${MONTH_DUE[period]}-15`;
    case 'tds24q':
    case 'tds26q': return TDS_DUE[period];
    case 'advance-tax': return ADV_DUE[period];
    default: return ANNUAL_DUE[complianceId]?.[period] ?? '2025-10-31';
  }
}
