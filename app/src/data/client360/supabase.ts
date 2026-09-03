/**
 * IMP-022 — Client 360 SUPABASE adapter (production path).
 *
 * Application-side composition over plain PostgREST reads under RLS
 * (API-ARCH-03) — intentionally NO aggregate SECURITY DEFINER RPC: RLS
 * remains the authoritative filter on every underlying statement, so the
 * composite can never surface a row the caller could not read directly
 * (API-SEC; instruction §8). Reads reuse the IMP-020/021 adapters; the
 * only new queries are the staff directory (firm_memberships ⋈ profiles
 * per RLS-MEM-01/RLS-PRF-01) and relationship endpoint-name resolution.
 *
 * API-ERR-02: an unknown, inaccessible, or malformed client id all
 * produce the same null result — the composite is no existence oracle.
 */
import { getActiveFirm } from '@/data/context';
import { supabaseClientHierarchy } from '@/data/clientHierarchy/supabase';
import { supabaseEngagements } from '@/data/engagements/supabase';
import { toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type { MembershipRole } from '@/data/tenancy';
import type {
  Client360Engagement,
  Client360Relationship,
  Client360Service,
  Client360View,
  StaffRef,
} from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MembershipRow {
  id: string;
  user_id: string;
  role: MembershipRole;
  status: 'invited' | 'active' | 'suspended' | 'removed';
}

interface ProfileRow {
  id: string;
  full_name: string;
}

interface EntityNameRow {
  id: string;
  client_id: string;
  legal_name: string;
}

/**
 * Own-firm memberships + display names. RLS scopes both reads (own-firm
 * memberships; shared-firm profile display fields), so no firm filter is
 * required for authorization — the active-firm selector (when present)
 * merely narrows the directory to the working context. Without an active
 * firm the directory is empty and names render as null; reads never fail
 * closed on a missing selector (that fail-closed rule is for WRITES).
 */
async function loadStaffMap(activeOnly: boolean): Promise<Map<string, StaffRef>> {
  const firmId = getActiveFirm();
  if (!firmId) return new Map();
  let query = getSupabaseClient()
    .from('firm_memberships')
    .select('id, user_id, role, status')
    .eq('firm_id', firmId);
  if (activeOnly) query = query.eq('status', 'active');
  const { data: memberships, error } = await query;
  if (error) throw toApiError(error);
  const rows = (memberships ?? []) as unknown as MembershipRow[];
  if (!rows.length) return new Map();

  const { data: profiles, error: profileError } = await getSupabaseClient()
    .from('profiles')
    .select('id, full_name')
    .in(
      'id',
      rows.map((m) => m.user_id),
    );
  if (profileError) throw toApiError(profileError);
  const names = new Map(((profiles ?? []) as unknown as ProfileRow[]).map((p) => [p.id, p.full_name]));

  return new Map(
    rows.map((m) => [
      m.id,
      { membershipId: m.id, fullName: names.get(m.user_id) ?? 'Unknown', role: m.role },
    ]),
  );
}

export const supabaseClient360: Client360Service = {
  mode: 'supabase',

  async getClient360(clientId) {
    // Malformed ids never reach PostgREST (a 400 there would be a
    // validation error, breaking the not-found uniformity of API-ERR-02).
    if (!UUID_RE.test(clientId)) return null;
    const client = await supabaseClientHierarchy.getClient(clientId);
    if (!client) return null;

    // Every read below is independently RLS-scoped; a manager sees only
    // portfolio rows, billing/senior/article never get this far (the
    // client row itself was already null for them).
    const legalEntities = await supabaseClientHierarchy.listLegalEntities(clientId);
    const [registrations, contacts, engagementRows, staff] = await Promise.all([
      Promise.all(legalEntities.map((e) => supabaseClientHierarchy.listRegistrations(e.id))),
      supabaseClientHierarchy.listContacts(clientId),
      supabaseEngagements.listEngagements({ clientId }),
      // All statuses: a suspended partner's name must still render on
      // historical engagements (DM-03 — attributions survive suspension).
      loadStaffMap(false),
    ]);

    const engagements: Client360Engagement[] = engagementRows.map((engagement) => ({
      engagement,
      responsiblePartnerName:
        staff.get(engagement.responsiblePartnerMembershipId)?.fullName ?? null,
    }));

    // Group edges for every entity of this client, deduped.
    const seen = new Set<string>();
    const edges = (
      await Promise.all(
        legalEntities.map(async (e) => {
          const list = await supabaseClientHierarchy.listClientRelationships(e.id);
          return list.filter((edge) => {
            if (seen.has(edge.id)) return false;
            seen.add(edge.id);
            return true;
          });
        }),
      )
    ).flat();

    // Resolve endpoint names — including endpoints belonging to OTHER
    // clients of the firm (group trees cross clients, DM-07). RLS decides
    // which endpoint rows exist for the caller; an endpoint outside the
    // caller's scope renders as 'Restricted entity' without leaking its
    // identity (API-ERR-02).
    const ownNames = new Map<string, EntityNameRow>(
      legalEntities.map((e) => [e.id, { id: e.id, client_id: e.clientId, legal_name: e.legalName }]),
    );
    const missing = [
      ...new Set(edges.flatMap((e) => [e.fromEntityId, e.toEntityId])),
    ].filter((id) => !ownNames.has(id));
    if (missing.length) {
      const { data, error } = await getSupabaseClient()
        .from('legal_entities')
        .select('id, client_id, legal_name')
        .in('id', missing);
      if (error) throw toApiError(error);
      for (const row of (data ?? []) as unknown as EntityNameRow[]) ownNames.set(row.id, row);
    }

    const relationships: Client360Relationship[] = edges.map((edge) => {
      const from = ownNames.get(edge.fromEntityId);
      const to = ownNames.get(edge.toEntityId);
      return {
        id: edge.id,
        relationType: edge.relationType,
        status: edge.status,
        effectiveFrom: edge.effectiveFrom,
        effectiveTo: edge.effectiveTo,
        fromEntityId: edge.fromEntityId,
        fromEntityName: from?.legal_name ?? 'Restricted entity',
        fromClientId: from?.client_id ?? '',
        toEntityId: edge.toEntityId,
        toEntityName: to?.legal_name ?? 'Restricted entity',
        toClientId: to?.client_id ?? '',
      };
    });

    const view: Client360View = {
      client,
      ownerPartner: staff.get(client.ownerPartnerMembershipId) ?? null,
      manager: client.managerMembershipId
        ? (staff.get(client.managerMembershipId) ?? null)
        : null,
      legalEntities,
      registrations: registrations.flat(),
      contacts,
      relationships,
      engagements,
    };
    return view;
  },

  async listActiveStaff() {
    return [...(await loadStaffMap(true)).values()];
  },
};
