/**
 * IMP-062 — Limited Realtime (R1-B): the provider-neutral freshness
 * subscription shared by the two approved API-RT-01 surfaces.
 *
 * One call = the complete freshness mechanism for one consumer:
 *
 *   1. ALWAYS-ON POLLING (API-RT-07): the approved 15 s polling fallback
 *      stays running as the resilience backstop. Realtime events can be
 *      missed (ephemeral transport), duplicated, reordered, or lost on the
 *      first broadcast after a tenant boot; read-derivations with no write
 *      (alert snooze expiry, TEST-API-18) produce no event at all. The
 *      polling tick heals every one of those within one interval, so the
 *      accepted freshness floor never regresses and correctness never
 *      depends on delivery (API-RT-05).
 *
 *   2. PRIVATE FIRM-TOPIC CHANNEL (R1-B): the shared hub channel turns
 *      database-trigger broadcasts into prompt bare invalidations — the
 *      same callback, the same authoritative RLS re-read, no payload data
 *      ever applied.
 *
 * Both signals are the SAME bare invalidation; duplicates are harmless.
 * Requires an active-firm selector context (no context → no subscription,
 * unchanged). Unsubscribe always clears the timer and releases the topic
 * listener (channel removed when the topic's last listener releases).
 */
import { getActiveFirm } from '@/data/context';

import { acquireTopicListener } from './hub';
import { firmSurfaceTopic } from './topics';
import type { RealtimeSurface } from './types';

export function subscribeFirmInvalidation(
  surface: RealtimeSurface,
  onInvalidate: () => void,
  pollIntervalMs: number,
): () => void {
  const firmId = getActiveFirm();
  if (!firmId) return () => {}; // no selector context → no subscription
  const timer = setInterval(onInvalidate, pollIntervalMs);
  const topic = firmSurfaceTopic(firmId, surface);
  // A malformed firm id fails closed to polling-only (the DB re-validates
  // the selector against live membership on every authoritative read).
  const release = topic ? acquireTopicListener(topic, onInvalidate) : () => {};
  return () => {
    clearInterval(timer);
    release();
  };
}
