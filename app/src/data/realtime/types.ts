/**
 * IMP-062 — Limited Realtime (R1-B): shared types for the firm-topic
 * invalidation channel module.
 *
 * Exactly two surfaces exist (API-RT-01): the review queue count/list and
 * the alert badge/count. No other surface may subscribe (API-RT-02).
 */
export type RealtimeSurface = 'review_queue' | 'alerts';
