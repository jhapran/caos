/**
 * IMP-021 — Engagement barrel: the stable public contract plus the
 * selected adapter. Implementation modules (./fixture, ./supabase) are
 * internal — never import them from consumers.
 */
export { engagementService } from './engagementService';
export type {
  CreateEngagementInput,
  EngagementListFilter,
  EngagementRecord,
  EngagementLetterStatus,
  EngagementService,
  EngagementStatus,
  LetterStatus,
  UpdateEngagementInput,
} from './types';
