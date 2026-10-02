/**
 * IMP-062 — Limited Realtime (R1-B): private firm-scoped topic construction.
 *
 * Topic contract (independently reviewed; enforced server-side by the
 * realtime.messages SELECT policy in 20261002000000_limited_realtime.sql):
 *
 *   firm:<canonical firm uuid>:review_queue
 *   firm:<canonical firm uuid>:alerts
 *
 * Client-side construction fails closed: a malformed firm id produces NO
 * topic and therefore NO channel — the server-side regex gate is the
 * enforcement boundary; this is defense in depth, never authorization.
 */
import type { RealtimeSurface } from './types';

const CANONICAL_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The private topic for one surface of one firm, or null (fail closed)
 *  when the firm id is not a canonical UUID. */
export function firmSurfaceTopic(firmId: string, surface: RealtimeSurface): string | null {
  if (!CANONICAL_UUID.test(firmId)) return null;
  return `firm:${firmId}:${surface}`;
}
