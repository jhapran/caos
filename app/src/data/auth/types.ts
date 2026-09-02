/**
 * IMP-011 — Auth adapter types (authentication only, AUTH-00).
 *
 * Authentication establishes WHO the user is. Nothing here carries firm
 * membership, role, or tenant authority — authorization is PostgreSQL RLS
 * with the resolved DEC-J live FirmMembership lookup (IMP-012).
 */

// Canonical definition lives in @/data/source (IMP-014 single selection
// boundary); re-exported here so auth consumers keep one import site.
export type { DataSource } from '../source';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  email: string;
}

/** Session snapshot — identity and assurance only, never tenant claims. */
export interface AuthSnapshot {
  status: AuthStatus;
  user: AuthUser | null;
}

export type Aal = 'aal1' | 'aal2' | null;

export interface Assurance {
  aal: Aal;
  hasVerifiedTotpFactor: boolean;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export interface MfaEnrollResult extends AuthResult {
  factorId?: string;
  secret?: string;
  uri?: string;
}
