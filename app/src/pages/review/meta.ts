import { BookOpen, FileText, FolderCheck, Landmark, Receipt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReviewItemRecord, ReviewItemType } from '@/data';

/**
 * Presentation metadata over the frozen R0 review type keys (API-OQ-01):
 * stored values are always the stable keys; labels/slugs are display-only.
 */
export const REVIEW_TYPE_META: Record<
  ReviewItemType,
  { icon: LucideIcon; slug: string; label: string; plural: string }
> = {
  gst_reconciliation: { icon: Receipt, slug: 'gst-reco', label: 'GST Reconciliation', plural: 'GST reconciliations' },
  tds_return: { icon: Landmark, slug: 'tds', label: 'TDS Return', plural: 'TDS returns' },
  itr_computation: { icon: FileText, slug: 'itr', label: 'ITR Computation', plural: 'ITR computations' },
  financial_statements: { icon: BookOpen, slug: 'fs', label: 'Financial Statements', plural: 'Financial statements' },
  audit_workpaper: { icon: FolderCheck, slug: 'audit-wp', label: 'Audit Workpaper', plural: 'Audit workpapers' },
};

export const TYPE_ORDER: ReviewItemType[] = [
  'gst_reconciliation',
  'tds_return',
  'itr_computation',
  'financial_statements',
  'audit_workpaper',
];

export function slugToType(slug: string | null): ReviewItemType | null {
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

/** Deterministic mono risk score (30–84) for the row chip (fixture demo). */
export function pseudoRiskScore(id: string): number {
  return 30 + (hash(id) % 55);
}

export interface PreCheck {
  ok: boolean;
  text: string;
}

const PRE_CHECKS: Record<ReviewItemType, PreCheck[][]> = {
  gst_reconciliation: [
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
  tds_return: [
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
  itr_computation: [
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
  financial_statements: [
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
  audit_workpaper: [
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

/** 3 deterministic CAOS pre-check bullets for an item (fixture demo). */
export function preChecksFor(item: Pick<ReviewItemRecord, 'id' | 'type'>): PreCheck[] {
  const variants = PRE_CHECKS[item.type];
  return variants[hash(item.id) % variants.length];
}

const DOC_NAMES: Record<ReviewItemType, string[][]> = {
  gst_reconciliation: [
    ['gstr2a_aug.csv', 'books_aug.xlsx', 'reco_working.xlsx'],
    ['gstr1_vs_books.xlsx', 'einvoice_register.csv'],
  ],
  tds_return: [
    ['26q_deductions.xlsx', 'form26as_q2.pdf', 'challan_register.csv'],
    ['tds_ledger_194c.xlsx', 'rate_check_working.pdf'],
  ],
  itr_computation: [
    ['itr6_computation.xlsx', 'capgains_working.xlsx', 'mat_check.pdf'],
    ['depreciation_schedule.xlsx', 'loss_schedule.pdf'],
  ],
  financial_statements: [
    ['draft_bs_pl.pdf', 'notes_to_accounts.docx', 'cashflow_tieout.xlsx'],
    ['trial_balance_fy25.xlsx', 'related_party_note.docx'],
  ],
  audit_workpaper: [
    ['fa_verification_wp.xlsx', 'debtors_confirmations.pdf'],
    ['statutory_dues_wp.xlsx', 'lead_schedules.xlsx'],
  ],
};

/** Deterministic faux document names for the thumbnails row (fixture demo). */
export function docsFor(item: Pick<ReviewItemRecord, 'id' | 'type'>): string[] {
  const variants = DOC_NAMES[item.type];
  return variants[hash(item.id) % variants.length];
}
