/**
 * IMP-022 — Client 360 barrel: the stable public contract plus the
 * selected adapter. Implementation modules (./fixture, ./supabase) are
 * internal — never import them from consumers.
 */
export { client360Service } from './client360Service';
export type {
  Client360Engagement,
  Client360Relationship,
  Client360Service,
  Client360View,
  StaffRef,
} from './types';
