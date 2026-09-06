/**
 * IMP-042 (data-adapter slice) — My Work barrel: the stable public contract
 * plus the selected adapter. Implementation modules (./fixture, ./supabase)
 * are internal — never import them from consumers. The pure DEC-L helpers
 * are exported for the UI slice (business-date display) and tests.
 */
export { myworkService } from './myworkService';
export {
  buildMyWorkBuckets,
  isoWeekEndDate,
  kolkataBusinessDate,
  STANDALONE_RETURNED_NEXT_ACTION,
} from './types';
export type { MyWorkBuckets, MyWorkItem, MyWorkItemKind, MyWorkService } from './types';
