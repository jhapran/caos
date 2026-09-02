/**
 * IMP-020 — Active-firm selector context (RLS-CTX-01/02).
 *
 * Holds the caller's CURRENTLY SELECTED firm for the session so the
 * Supabase adapter path can send it as the `x-active-firm` request header.
 *
 * Trust model (security-critical, do not weaken):
 *   - This value is SELECTOR CONTEXT ONLY. It carries zero authority.
 *   - The database re-validates it on every request against the caller's
 *     LIVE firm_memberships row (auth.uid() + status + role, DEC-J /
 *     RLS-MECH-01). A forged or stale selection grants nothing — policies
 *     simply resolve to "no rows / denied".
 *   - It must never be used client-side to decide what the user is
 *     ALLOWED to see; only which firm workspace they are looking at.
 *
 * Deliberately a plain module-level holder, not React state: the browser
 * client's custom fetch (src/lib/supabaseClient.ts) reads it outside the
 * React tree. UI state (React context) may mirror it later; this module
 * remains the single source the adapter path reads.
 */

let activeFirmId: string | null = null;

/** Select the working firm for subsequent requests (null clears). */
export function setActiveFirm(firmId: string | null): void {
  activeFirmId = firmId;
}

/** The currently selected firm id, or null when none is selected. */
export function getActiveFirm(): string | null {
  return activeFirmId;
}

/** Clear the selection (logout / firm switch teardown). */
export function clearActiveFirm(): void {
  activeFirmId = null;
}
