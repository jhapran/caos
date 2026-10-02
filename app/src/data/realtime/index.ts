/**
 * IMP-062 — Limited Realtime (R1-B): internal adapter-layer module.
 *
 * Consumed ONLY by the Supabase adapters of the two approved surfaces
 * (src/data/review, src/data/alerts). UI components keep using the
 * provider-neutral subscribeReviewQueue/subscribeAlerts contracts and must
 * never import this module (or any Supabase machinery) directly.
 */
export { setRealtimeChannelsEnabled } from './hub';
export { subscribeFirmInvalidation } from './subscribe';
export type { RealtimeSurface } from './types';
