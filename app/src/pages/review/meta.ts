import { BookOpen, FileText, FolderCheck, Landmark, Receipt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReviewItem, ReviewType } from '@/data';

/** Icon + deep-link slug + display labels per review type. */
export const REVIEW_TYPE_META: Record<ReviewType, { icon: LucideIcon; slug: string; plural: string }> = {
  'GST Reconciliation': { icon: Receipt, slug: 'gst-reco', plural: 'GST reconciliations' },
  TDS: { icon: Landmark, slug: 'tds', plural: 'TDS returns' },
  ITR: { icon: FileText, slug: 'itr', plural: 'ITR computations' },
  'Financial Statements': { icon: BookOpen, slug: 'fs', plural: 'Financial statements' },
  'Audit Workpaper': { icon: FolderCheck, slug: 'audit-wp', plural: 'Audit workpapers' },
};

export const TYPE_ORDER: ReviewType[] = ['GST Reconciliation', 'TDS', 'ITR', 'Financial Statements', 'Audit Workpaper'];

export function slugToType(slug: string | null): ReviewType | null {
  if (!slug) return null;
  for (const t of TYPE_ORDER) if (REVIEW_TYPE_META[t].slug === slug) return t;
  return null;
}

/** Deterministic hash from an item id (stable across renders/sessions). */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic mono risk score (30–84) for the row chip. */
export function pseudoRiskScore(id: string): number {
  return 30 + (hash(id) % 55);
}

export interface PreCheck {
  ok: boolean;
  text: string;
}

const PRE_CHECKS: Record<ReviewType, PreCheck[][]> = {
  'GST Reconciliation': [
    [
      { ok: true, text: '2A-vs-books variance within ₹500 on 2 of 3 months' },
      { ok: false, text: 'Aug variance ₹4,820 — see line 14 of the working' },
      { ok: true, text: 'Prior-period filing matches books' },
    ],
    [
      { ok: true, text: 'Outward liability ties to e-invoice register' },
      { ok: true, text: 'Credit notes mapped to original invoices' },
      { ok: false, text: '2B ITC of ₹12,400 pending vendor filing — flagged' },
    ],
  ],
  TDS: [
    [
      { ok: true, text: 'Challan amounts match 26AS for 11 of 12 deductees' },
      { ok: false, text: 'One challan (₹18,400) unlinked — flagged for tracing' },
      { ok: true, text: 'Deduction rates verified against section mapping' },
    ],
    [
      { ok: true, text: 'PAN availability ≥ 95% — no higher-rate exposure' },
      { ok: true, text: 'Interest u/s 201 computed: nil' },
      { ok: false, text: 'Two deductee PANs pending verification' },
    ],
  ],
  ITR: [
    [
      { ok: true, text: 'Computation ties to audited P&L within ₹1,000' },
      { ok: true, text: 'MAT working cross-checked against Book Profit' },
      { ok: false, text: 'Depreciation rate on one asset block needs confirmation' },
    ],
    [
      { ok: true, text: 'Capital gains indexed per CII table' },
      { ok: false, text: 'Loss carry-forward schedule has an open query' },
      { ok: true, text: 'Advance tax credits match 26AS' },
    ],
  ],
  'Financial Statements': [
    [
      { ok: true, text: 'Trial balance ties to draft BS & P&L' },
      { ok: true, text: 'Related-party disclosures complete per AS-18' },
      { ok: false, text: 'Cash flow: financing movement of ₹6.2 L needs narration' },
    ],
    [
      { ok: true, text: 'Opening balances agree to prior-year signed FS' },
      { ok: false, text: 'Two notes to accounts pending partner wording' },
      { ok: true, text: 'Rounding-off consistent at ₹ hundreds' },
    ],
  ],
  'Audit Workpaper': [
    [
      { ok: true, text: 'Fixed-asset additions vouched above threshold' },
      { ok: true, text: 'Debtors confirmations received for 80% of value' },
      { ok: false, text: 'Statutory dues: PF challan for Jul pending upload' },
    ],
    [
      { ok: true, text: 'Sampling plan followed per audit programme' },
      { ok: false, text: 'One confirmation reply has a balance difference' },
      { ok: true, text: 'Lead schedule ties to trial balance' },
    ],
  ],
};

/** 3 deterministic CAOS pre-check bullets for an item. */
export function preChecksFor(item: ReviewItem): PreCheck[] {
  const variants = PRE_CHECKS[item.type];
  return variants[hash(item.id) % variants.length];
}

const DOC_NAMES: Record<ReviewType, string[][]> = {
  'GST Reconciliation': [
    ['gstr2a_aug.csv', 'books_aug.xlsx', 'reco_working.xlsx'],
    ['gstr1_vs_books.xlsx', 'einvoice_register.csv'],
  ],
  TDS: [
    ['26q_deductions.xlsx', 'form26as_q2.pdf', 'challan_register.csv'],
    ['tds_ledger_194c.xlsx', 'rate_check_working.pdf'],
  ],
  ITR: [
    ['itr6_computation.xlsx', 'capgains_working.xlsx', 'mat_check.pdf'],
    ['depreciation_schedule.xlsx', 'loss_schedule.pdf'],
  ],
  'Financial Statements': [
    ['draft_bs_pl.pdf', 'notes_to_accounts.docx', 'cashflow_tieout.xlsx'],
    ['trial_balance_fy25.xlsx', 'related_party_note.docx'],
  ],
  'Audit Workpaper': [
    ['fa_verification_wp.xlsx', 'debtors_confirmations.pdf'],
    ['statutory_dues_wp.xlsx', 'lead_schedules.xlsx'],
  ],
};

/** Deterministic faux document names for the thumbnails row. */
export function docsFor(item: ReviewItem): string[] {
  const variants = DOC_NAMES[item.type];
  return variants[hash(item.id) % variants.length];
}
