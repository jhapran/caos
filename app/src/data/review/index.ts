/**
 * IMP-041 PASS C — Review queue barrel: the stable public contract plus the
 * selected adapter. Implementation modules (./fixture, ./supabase) are
 * internal — never import them from consumers.
 */
export { reviewService } from './reviewService';
export type {
  DecideReviewItemInput,
  DecideReviewItemResult,
  ReviewDecision,
  ReviewItemRecord,
  ReviewItemSource,
  ReviewItemStatus,
  ReviewItemType,
  ReviewQueueFilter,
  ReviewService,
  SubmitReviewItemInput,
} from './types';
