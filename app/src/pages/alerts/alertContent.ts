// Page-local presentation content for the Risk Alerts page (risk-alerts.md).
// IDs match the seeded ALERTS fixtures so acknowledge / resolve status flows
// through useDemoStore() and stays in sync with the sidebar badge.

import {
  AlertOctagon,
  BellRing,
  Clock3,
  FileSignature,
  IndianRupee,
  KeyRound,
  Scale,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AlertSeverityBand = 'critical' | 'high' | 'watch';

export interface AlertEntity {
  clientId: string;
  risk: number;
  missing: string;
}

export interface WhyBullet {
  icon: LucideIcon;
  text: string;
}

export interface AlertContent {
  id: string; // a-01 … a-05 (matches src/data/alerts.ts)
  severity: AlertSeverityBand;
  title: string;
  age: string;
  rule: string;
  detectedAt: string;
  bodyStrong: string;
  bodyText: string;
  entities: AlertEntity[];
  /** total affected (entities.length preview + remainder) */
  affectedTotal: number;
  affectedLabel: string;
  icon: LucideIcon;
  primaryAction: { label: string; kind: 'navigate' | 'drawer' | 'toast'; href?: string; toast?: string };
  why: WhyBullet[];
  recommendation: string;
  execute?: { ticks: number; tickLabel: string; toast: string };
}

export const ALERT_CONTENT: AlertContent[] = [
  {
    id: 'a-01',
    severity: 'critical',
    title: 'GST filing deadline in 48 hours — 18 clients incomplete',
    age: 'raised 2h ago',
    rule: 'statutory-deadline-exposure',
    detectedAt: 'Detected 09:12',
    bodyStrong: '18 clients',
    bodyText: 'are neither ready nor filed for GSTR-3B with the statutory due date 48 hours away.',
    entities: [
      { clientId: 'c-abc', risk: 88, missing: 'GSTR-2A reco' },
      { clientId: 'c-pqr', risk: 84, missing: 'Bank stmts (Aug)' },
      { clientId: 'c-vedant', risk: 79, missing: 'Sales register' },
      { clientId: 'c-kaveri', risk: 74, missing: 'ITC workings' },
      { clientId: 'c-orion', risk: 68, missing: 'Purchase register' },
      { clientId: 'c-greenfield', risk: 63, missing: 'Client approval' },
    ],
    affectedTotal: 18,
    affectedLabel: 'clients incomplete',
    icon: AlertOctagon,
    primaryAction: {
      label: 'View 18 clients',
      kind: 'navigate',
      href: '/deadlines/gstr3b::Aug 2025/clients?filter=risk,blocked',
    },
    why: [
      { icon: Users, text: '18 of 240 GSTR-3B clients are neither ready nor filed for the Aug 2025 period.' },
      { icon: Clock3, text: 'Statutory due date is 20 Sep — current prep velocity is 6 filings/day.' },
      { icon: TrendingUp, text: 'Projected 12 late filings at current velocity; late fee ₹200/day per return.' },
    ],
    recommendation: 'Bulk-remind the 11 clients blocking on documents; escalate the 4 unresponsive ones to partner calls.',
    execute: { ticks: 11, tickLabel: 'reminders sent', toast: '11 reminders sent · 4 escalated' },
  },
  {
    id: 'a-02',
    severity: 'high',
    title: 'Partner workload threshold exceeded',
    age: 'raised 5h ago',
    rule: 'workload-threshold',
    detectedAt: 'Detected 06:40',
    bodyStrong: '117%',
    bodyText: 'of review capacity — Pranav has 9 items queued for more than 2 days.',
    entities: [
      { clientId: 'c-lmn', risk: 71, missing: 'FS sign-off' },
      { clientId: 'c-trident', risk: 66, missing: 'Tax audit review' },
      { clientId: 'c-abc', risk: 64, missing: 'GST reco approval' },
    ],
    affectedTotal: 9,
    affectedLabel: 'items queued',
    icon: Scale,
    primaryAction: { label: 'Rebalance', kind: 'drawer' },
    why: [
      { icon: Scale, text: 'Pranav is at 117% of review capacity — the firm threshold is 110%.' },
      { icon: Clock3, text: '9 review items have been queued for more than 2 days.' },
      { icon: TrendingUp, text: 'Priya Nair is at 72% capacity — rebalancing clears the queue in 1.5 days.' },
    ],
    recommendation: 'Reassign 5 queued reviews to Priya Nair and 2 to Rahul Verma to bring Pranav under 90%.',
  },
  {
    id: 'a-03',
    severity: 'high',
    title: '7 client DSCs expire within 30 days',
    age: 'raised 1d ago',
    rule: 'dsc-expiry',
    detectedAt: 'Detected 09:12',
    bodyStrong: '7 DSCs',
    bodyText: 'expire within 30 days — filings block hard without a valid signature. Earliest: PQR Industries in 9 days.',
    entities: [
      { clientId: 'c-pqr', risk: 81, missing: 'Expires in 9d' },
      { clientId: 'c-vedant', risk: 70, missing: 'Expires in 14d' },
      { clientId: 'c-lmn', risk: 66, missing: 'Expires in 18d' },
      { clientId: 'c-crestpoint', risk: 58, missing: 'Expires in 22d' },
      { clientId: 'c-indus', risk: 52, missing: 'Expires in 25d' },
      { clientId: 'c-astra', risk: 47, missing: 'Expires in 28d' },
    ],
    affectedTotal: 7,
    affectedLabel: 'DSCs expiring',
    icon: KeyRound,
    primaryAction: {
      label: 'Send renewal notices',
      kind: 'toast',
      toast: 'DSC renewal notices sent to 7 clients',
    },
    why: [
      { icon: KeyRound, text: '7 digital signature certificates expire within the 30-day renewal window.' },
      { icon: Clock3, text: 'Earliest expiry: PQR Industries — 9 days. DSC renewal takes 2–3 working days.' },
      { icon: BellRing, text: 'Tax audit and MCA filings cannot be signed without a valid DSC.' },
    ],
    recommendation: 'Send renewal notices with the DocumentChecklist today; book Class-3 re-issuance for PQR Industries immediately.',
    execute: { ticks: 7, tickLabel: 'notices sent', toast: 'Renewal notices sent to 7 clients' },
  },
  {
    id: 'a-04',
    severity: 'watch',
    title: '4 engagements lack signed engagement letters',
    age: 'raised 1d ago',
    rule: 'engagement-letter-hygiene',
    detectedAt: 'Detected 09:12',
    bodyStrong: '4 engagements',
    bodyText: 'are in flight without signed engagement letters — compliance hygiene, required before filing.',
    entities: [
      { clientId: 'c-rst', risk: 44, missing: 'FY 2024-25 letter' },
      { clientId: 'c-nilgiri', risk: 41, missing: 'FY 2024-25 letter' },
      { clientId: 'c-bluelotus', risk: 38, missing: 'FY 2024-25 letter' },
      { clientId: 'c-zenith', risk: 35, missing: 'FY 2024-25 letter' },
    ],
    affectedTotal: 4,
    affectedLabel: 'engagements',
    icon: FileSignature,
    primaryAction: {
      label: 'Request signatures',
      kind: 'toast',
      toast: 'Signature requests sent to 4 clients',
    },
    why: [
      { icon: FileSignature, text: '4 active engagements have no signed engagement letter on file.' },
      { icon: BellRing, text: 'ICAI guidance requires a signed letter before attestation work begins.' },
      { icon: Clock3, text: 'All 4 have filings due within 45 days — letters must precede filing.' },
    ],
    recommendation: 'Send e-sign requests for the standard FY 2024-25 engagement letter to all 4 clients.',
    execute: { ticks: 4, tickLabel: 'requests sent', toast: 'Signature requests sent to 4 clients' },
  },
  {
    id: 'a-05',
    severity: 'watch',
    title: '11 invoices more than 90 days overdue — ₹8.4 L',
    age: 'raised 2d ago',
    rule: 'receivables-ageing',
    detectedAt: 'Detected 09:12',
    bodyStrong: '₹8.4 L',
    bodyText: 'locked in 11 invoices older than 90 days. Largest: RST Pvt Ltd ₹1.2 L · 118 days.',
    entities: [
      { clientId: 'c-rst', risk: 62, missing: '₹1.2 L · 118d' },
      { clientId: 'c-aravali', risk: 55, missing: '₹1.05 L · 112d' },
      { clientId: 'c-harbourline', risk: 51, missing: '₹0.96 L · 107d' },
    ],
    affectedTotal: 11,
    affectedLabel: 'invoices overdue',
    icon: IndianRupee,
    primaryAction: { label: 'Open receivables list', kind: 'drawer' },
    why: [
      { icon: IndianRupee, text: '11 invoices totalling ₹8.4 lakh have crossed 90 days outstanding.' },
      { icon: TrendingUp, text: 'Largest exposure: RST Pvt Ltd — ₹1.2 lakh at 118 days, last follow-up 22 Aug.' },
      { icon: Clock3, text: 'Firm policy: partner review once receivables cross 90 days.' },
    ],
    recommendation: 'Send statements of account to all 11 clients and schedule partner calls for the top 3 exposures.',
    execute: { ticks: 11, tickLabel: 'statements sent', toast: 'Statements sent to 11 clients' },
  },
];

export interface ReceivableRow {
  invoice: string;
  clientId: string;
  amount: number; // paise-free rupees
  days: number;
  lastFollowUp: string;
}

/** 11 invoices, ₹8,40,000 total, all > 90 days overdue (largest RST ₹1.2 L). */
export const RECEIVABLES: ReceivableRow[] = [
  { invoice: 'INV-24-0187', clientId: 'c-rst', amount: 120000, days: 118, lastFollowUp: '22 Aug' },
  { invoice: 'INV-24-0164', clientId: 'c-aravali', amount: 105000, days: 112, lastFollowUp: '25 Aug' },
  { invoice: 'INV-24-0203', clientId: 'c-harbourline', amount: 96000, days: 107, lastFollowUp: '28 Aug' },
  { invoice: 'INV-24-0211', clientId: 'c-deccan', amount: 88000, days: 101, lastFollowUp: '30 Aug' },
  { invoice: 'INV-25-0012', clientId: 'c-palm', amount: 79000, days: 97, lastFollowUp: '02 Sep' },
  { invoice: 'INV-25-0019', clientId: 'c-seagull', amount: 71000, days: 95, lastFollowUp: '03 Sep' },
  { invoice: 'INV-25-0024', clientId: 'c-rajhans', amount: 66000, days: 94, lastFollowUp: '04 Sep' },
  { invoice: 'INV-25-0031', clientId: 'c-northstar', amount: 59000, days: 93, lastFollowUp: '05 Sep' },
  { invoice: 'INV-25-0038', clientId: 'c-copperpot', amount: 54000, days: 92, lastFollowUp: '06 Sep' },
  { invoice: 'INV-25-0042', clientId: 'c-meridian', amount: 60000, days: 91, lastFollowUp: '07 Sep' },
  { invoice: 'INV-25-0049', clientId: 'c-trailblazer', amount: 42000, days: 90, lastFollowUp: '08 Sep' },
];

export const RECEIVABLES_TOTAL = RECEIVABLES.reduce((s, r) => s + r.amount, 0); // 840000

export interface AlertRule {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
}

export const ALERT_RULES: AlertRule[] = [
  { id: 'rule-deadline', label: 'Statutory deadline exposure < 72h', description: 'Fires when incomplete filings outpace prep velocity inside 72 hours of a due date.', defaultOn: true },
  { id: 'rule-workload', label: 'Workload > 110%', description: 'Flags any team member whose review queue exceeds 110% of weekly capacity.', defaultOn: true },
  { id: 'rule-dsc', label: 'DSC expiry < 30 days', description: 'Tracks digital signature certificates nearing expiry across all clients.', defaultOn: true },
  { id: 'rule-letter', label: 'Missing engagement letter before filing', description: 'Blocks attestation work on engagements without a signed letter.', defaultOn: true },
  { id: 'rule-receivables', label: 'Invoice overdue > 90 days', description: 'Surfaces receivables ageing past the firm’s 90-day policy line.', defaultOn: true },
  { id: 'rule-silent', label: 'Client unresponsive > 3 reminders', description: 'Escalates clients who have not replied after three automated reminders.', defaultOn: false },
];

export interface ResolvedAlert {
  id: string;
  title: string;
  resolvedBy: string;
  resolvedOn: string;
}

export const RESOLVED_ALERTS: ResolvedAlert[] = [
  { id: 'ra-01', title: 'GSTR-2A mismatch > ₹50k — LMN Ltd', resolvedBy: 'Priya Nair', resolvedOn: '04 Sep' },
  { id: 'ra-02', title: 'TDS challan short-payment — Vedant Alloys', resolvedBy: 'Rahul Verma', resolvedOn: '03 Sep' },
  { id: 'ra-03', title: 'PF return late for 2 months — Quickmed', resolvedBy: 'Neha Iyer', resolvedOn: '02 Sep' },
  { id: 'ra-04', title: 'Director KYC pending — Crestpoint Realty', resolvedBy: 'Amit Shah', resolvedOn: '01 Sep' },
  { id: 'ra-05', title: 'Advance tax shortfall Q1 — Astra Cloud', resolvedBy: 'Priya Nair', resolvedOn: '30 Aug' },
  { id: 'ra-06', title: 'GSTR-1 late fee exposure — 5 clients', resolvedBy: 'CA Pranav Sharma', resolvedOn: '28 Aug' },
  { id: 'ra-07', title: 'Audit confirmation pending — Trident Pharma', resolvedBy: 'Rahul Verma', resolvedOn: '26 Aug' },
  { id: 'ra-08', title: 'DSC expired — Orion Packaging', resolvedBy: 'Neha Iyer', resolvedOn: '22 Aug' },
  { id: 'ra-09', title: 'Books not closed Q1 — Blue Lotus Hotels', resolvedBy: 'Amit Shah', resolvedOn: '19 Aug' },
  { id: 'ra-10', title: '26AS mismatch — Rajhans Jewellers', resolvedBy: 'Priya Nair', resolvedOn: '15 Aug' },
  { id: 'ra-11', title: 'Invoice ageing > 60d — 6 clients', resolvedBy: 'CA Pranav Sharma', resolvedOn: '11 Aug' },
  { id: 'ra-12', title: 'MGT-7 AGM date unconfirmed — Kaveri Textiles', resolvedBy: 'Neha Iyer', resolvedOn: '08 Aug' },
];

export const SEVERITY_META: Record<
  AlertSeverityBand,
  { label: string; chip: string; border: string; iconChip: string; dot: string }
> = {
  critical: {
    label: 'Critical',
    chip: 'bg-critical-soft text-critical',
    border: 'border-l-critical',
    iconChip: 'bg-critical-soft text-critical',
    dot: 'bg-critical',
  },
  high: {
    label: 'High',
    chip: 'bg-warning-soft text-warning-strong',
    border: 'border-l-warning',
    iconChip: 'bg-warning-soft text-warning-strong',
    dot: 'bg-warning',
  },
  watch: {
    label: 'Watch',
    chip: 'bg-info-soft text-info',
    border: 'border-l-info',
    iconChip: 'bg-info-soft text-info',
    dot: 'bg-info',
  },
};
