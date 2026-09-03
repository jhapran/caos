/**
 * IMP-014 — Tenancy service: the session-facing data adapter skeleton
 * (API-R0-AUTH / API-R0-FRM) behind one provider-neutral contract.
 *
 * Two implementations of one interface (API-ARCH-02):
 *
 *   fixture   — demo track: a synthetic demo firm + profile, in-memory,
 *               never any network access (MIG-DS-06).
 *   supabase  — plain PostgREST reads under RLS (API-ARCH-03): the
 *               caller's OWN memberships (firm switching, RLS-CTX-02) and
 *               profile display fields (RLS-PRF-01). No RPC wrappers for
 *               row-shaped reads.
 *
 * Error semantics (API-ERR-02): collection reads return [] when nothing
 * is visible — never an error banner; single-resource reads return null
 * for nonexistent AND inaccessible ids alike (no existence oracle).
 * Provider errors are translated to the ApiError taxonomy (API-ERR-01) at
 * this boundary — Supabase types never leak to consumers.
 *
 * Authorization stays in the database: these reads carry NO tenant
 * authority; RLS decides what is visible (DEC-J, IMP-012).
 */
import { toApiError } from '@/data/errors';
import { getDataSource } from '@/data/source';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { DataSource } from '@/lib/env';

import type { FirmMembershipView, ProfileView } from './types';

export interface TenancyService {
  readonly mode: DataSource;
  /** The caller's own memberships (all statuses), for firm switching. */
  listMyMemberships(): Promise<FirmMembershipView[]>;
  /** The caller's own profile; null when no profile row exists. */
  getMyProfile(): Promise<ProfileView | null>;
  /**
   * Profile display fields for any user id visible to the caller
   * (RLS-PRF-01). null for nonexistent AND inaccessible ids — identical
   * shape, no existence oracle (API-ERR-02).
   */
  getProfile(userId: string): Promise<ProfileView | null>;
}

// ---------------------------------------------------------------------------
// Fixture implementation (demo track — in-memory, never any network)
// ---------------------------------------------------------------------------

const DEMO_PROFILE: ProfileView = {
  id: 'demo-fixture-user',
  fullName: 'Demo Principal',
  avatarUrl: null,
};

const fixtureService: TenancyService = {
  mode: 'fixture',
  listMyMemberships: async () => [
    {
      membershipId: 'demo-fixture-membership',
      firmId: 'demo-fixture-firm',
      firmName: 'CAOS Demo Firm',
      role: 'partner',
      status: 'active',
    },
  ],
  getMyProfile: async () => DEMO_PROFILE,
  getProfile: async (userId) => (userId === DEMO_PROFILE.id ? DEMO_PROFILE : null),
};

// ---------------------------------------------------------------------------
// Supabase implementation (plain reads under RLS — API-ARCH-03)
// ---------------------------------------------------------------------------

interface MembershipRow {
  id: string;
  role: FirmMembershipView['role'];
  status: FirmMembershipView['status'];
  firm_id: string;
  firms: { name: string } | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

const supabaseService: TenancyService = {
  mode: 'supabase',

  async listMyMemberships() {
    const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (sessionError) throw toApiError(sessionError);
    const uid = sessionData.session?.user?.id;
    if (!uid) return []; // no session → empty collection, never an error (API-ERR-02)
    const { data, error } = await getSupabaseClient()
      .from('firm_memberships')
      .select('id, role, status, firm_id, firms(name)')
      .eq('user_id', uid)
      // Stable ordering (RLS-CTX-02): the R0 default-firm rule and any
      // future switcher must never depend on incidental row order.
      .order('firm_id');
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as MembershipRow[]).map((row) => ({
      membershipId: row.id,
      firmId: row.firm_id,
      firmName: row.firms?.name ?? '',
      role: row.role,
      status: row.status,
    }));
  },

  async getMyProfile() {
    const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
    if (sessionError) throw toApiError(sessionError);
    const uid = sessionData.session?.user?.id;
    if (!uid) return null;
    return this.getProfile(uid);
  },

  async getProfile(userId) {
    const { data, error } = await getSupabaseClient()
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw toApiError(error);
    const row = data as ProfileRow | null;
    return row ? { id: row.id, fullName: row.full_name, avatarUrl: row.avatar_url } : null;
  },
};

/**
 * The active tenancy adapter, selected once through the single data-source
 * boundary (MIG-DS-02). Consumers use this — never the implementations.
 */
export const tenancyService: TenancyService =
  getDataSource() === 'supabase' ? supabaseService : fixtureService;
