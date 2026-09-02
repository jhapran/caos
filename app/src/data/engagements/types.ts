/**
 * IMP-021 — Engagement domain types (provider-neutral).
 *
 * Mirror the production schema (SCH-09, spec 06) one-to-one, in the
 * application-facing camelCase shape. An Engagement is the professional-
 * service scope / engagement-letter relationship belonging to a CLIENT
 * (DM-09) — never a legal entity, never the compliance subject. Deferred
 * per DM-09: e-sign flow, fee schedules, letter document generation.
 */
import type { DataSource } from '@/data/source';

// --- Vocabularies (mirror the CHECK constraints in 20260903000000) ---------

/** DM-SM-03 lifecycle: draft → proposed → active → completed | terminated. */
export type EngagementStatus = 'draft' | 'proposed' | 'active' | 'completed' | 'terminated';

export type LetterStatus = 'not_started' | 'issued' | 'signed' | 'expired';

// --- Records (read DTOs) ----------------------------------------------------

/** Engagement = the contracted professional-service scope for a client. */
export interface EngagementRecord {
  id: string;
  firmId: string;
  clientId: string;
  /** Live firm_memberships.id of the responsible partner (oversight, DM-09). */
  responsiblePartnerMembershipId: string;
  serviceLines: string[];
  letterStatus: LetterStatus;
  proposedAt: string | null;
  signedAt: string | null;
  periodLabel: string | null;
  status: EngagementStatus;
  terminationReason: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Letter-status projection for the billing role (RLS-ENG-01: "letter/fee
 * status only"; fee schedules are deferred per DM-09, so letter status is
 * the entire R0 surface). Delivered by the SECURITY DEFINER
 * list_engagement_letter_statuses() RPC, never by widening table SELECT.
 */
export interface EngagementLetterStatus {
  id: string;
  clientId: string;
  letterStatus: LetterStatus;
}

// --- Write inputs ------------------------------------------------------------

export interface CreateEngagementInput {
  clientId: string;
  responsiblePartnerMembershipId: string;
  serviceLines?: string[];
  letterStatus?: LetterStatus;
  proposedAt?: string | null;
  signedAt?: string | null;
  periodLabel?: string | null;
  status?: EngagementStatus;
  terminationReason?: string | null;
}

/** id/firmId are immutable; clientId (parentage) never changes. */
export type UpdateEngagementInput = Partial<Omit<CreateEngagementInput, 'clientId'>>;

// --- List filter -------------------------------------------------------------

export interface EngagementListFilter {
  clientId?: string;
  status?: EngagementStatus;
  letterStatus?: LetterStatus;
  responsiblePartnerMembershipId?: string;
  limit?: number;
  offset?: number;
}

// --- Service contract (API-R0-ENG) --------------------------------------------

/**
 * The provider-neutral engagement contract. Two implementations (fixture
 * demo track / Supabase production) sit behind this interface; consumers
 * import `engagementService` from `@/data` and never know which is active
 * (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02):
 *   - collection reads return [] when nothing is visible — never an error;
 *   - single-resource reads return null for nonexistent AND inaccessible
 *     ids alike (no existence oracle);
 *   - writes to unknown/inaccessible ids throw ApiError('not_found');
 *   - invalid DM-SM-03 status transitions throw ApiError('conflict');
 *   - rejected input (e.g. terminated without a reason) throws
 *     ApiError('validation');
 *   - RLS denials throw ApiError('unauthorized'); authorization is decided
 *     by the database, never by the adapter.
 */
export interface EngagementService {
  readonly mode: DataSource;

  listEngagements(filter?: EngagementListFilter): Promise<EngagementRecord[]>;
  getEngagement(engagementId: string): Promise<EngagementRecord | null>;
  createEngagement(input: CreateEngagementInput): Promise<EngagementRecord>;
  updateEngagement(
    engagementId: string,
    patch: UpdateEngagementInput,
  ): Promise<EngagementRecord>;

  /** Billing-role letter-status projection (RLS-ENG-01), active firm only. */
  listEngagementLetterStatuses(): Promise<EngagementLetterStatus[]>;
}
