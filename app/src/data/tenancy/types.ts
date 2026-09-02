/**
 * IMP-014 — Tenancy adapter types (API-R0-AUTH / API-R0-FRM skeleton).
 *
 * Provider-neutral session-facing views: WHO the caller is (profile) and
 * WHICH firms they belong to (memberships, for firm switching RLS-CTX-02).
 * Per resolved DEC-J, context derives from the LIVE FirmMembership
 * relationship (RLS-MECH-01) — never from JWT claims — so these reads go
 * to the database every time and carry no tenant authority of their own.
 */

// Values mirror the firm_memberships CHECK constraints (SCH-02, IMP-010).
export type MembershipRole =
  | 'super_admin'
  | 'partner'
  | 'manager'
  | 'senior'
  | 'article_executive'
  | 'billing'
  | 'external_consultant';

export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'removed';

/** One live membership of the caller, with its firm display name. */
export interface FirmMembershipView {
  membershipId: string;
  firmId: string;
  firmName: string;
  role: MembershipRole;
  status: MembershipStatus;
}

/** Profile display fields (RLS-PRF-01: own row, or shared-firm colleague). */
export interface ProfileView {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}
