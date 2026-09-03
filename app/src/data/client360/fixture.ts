/**
 * IMP-022 — Client 360 FIXTURE adapter (demo track, MIG-DS-06).
 *
 * Composes the demo-track singletons of the IMP-020/021 fixture adapters
 * (one fixture truth — this file adds no second copy of domain data) and
 * resolves staff display names from the demo TEAM roster. In-memory,
 * deterministic, Supabase-free, network-free.
 *
 * The demo roster roles are display strings; they map onto the SCH-03
 * vocabulary for the StaffRef contract (demo-only mapping, no spec owns
 * it).
 */
import { fixtureClientHierarchy } from '@/data/clientHierarchy/fixture';
import { TEAM } from '@/data/clients';
import { fixtureEngagements } from '@/data/engagements/fixture';

import type { MembershipRole } from '@/data/tenancy';
import type {
  Client360Engagement,
  Client360Relationship,
  Client360Service,
  Client360View,
  StaffRef,
} from './types';

const ROLE_MAP: Record<string, MembershipRole> = {
  Partner: 'partner',
  Manager: 'manager',
  'Senior Associate': 'senior',
  Associate: 'article_executive',
};

const staffDirectory: StaffRef[] = TEAM.map((m) => ({
  membershipId: m.id,
  fullName: m.name,
  role: ROLE_MAP[m.role] ?? 'senior',
}));

function staffRef(membershipId: string | null): StaffRef | null {
  if (!membershipId) return null;
  return staffDirectory.find((s) => s.membershipId === membershipId) ?? null;
}

export const fixtureClient360: Client360Service = {
  mode: 'fixture',

  async getClient360(clientId) {
    const client = await fixtureClientHierarchy.getClient(clientId);
    if (!client) return null;

    const legalEntities = await fixtureClientHierarchy.listLegalEntities(clientId);
    const registrations = (
      await Promise.all(legalEntities.map((e) => fixtureClientHierarchy.listRegistrations(e.id)))
    ).flat();
    const contacts = await fixtureClientHierarchy.listContacts(clientId);
    const engagements: Client360Engagement[] = (
      await fixtureEngagements.listEngagements({ clientId })
    ).map((engagement) => ({
      engagement,
      responsiblePartnerName: staffRef(engagement.responsiblePartnerMembershipId)?.fullName ?? null,
    }));

    // Group edges for every entity of this client, deduped, with both
    // endpoint names resolved through the same fixture hierarchy service.
    const seen = new Set<string>();
    const relationships: Client360Relationship[] = [];
    for (const entity of legalEntities) {
      for (const edge of await fixtureClientHierarchy.listClientRelationships(entity.id)) {
        if (seen.has(edge.id)) continue;
        seen.add(edge.id);
        const from = await fixtureClientHierarchy.getLegalEntity(edge.fromEntityId);
        const to = await fixtureClientHierarchy.getLegalEntity(edge.toEntityId);
        if (!from || !to) continue;
        relationships.push({
          id: edge.id,
          relationType: edge.relationType,
          status: edge.status,
          effectiveFrom: edge.effectiveFrom,
          effectiveTo: edge.effectiveTo,
          fromEntityId: from.id,
          fromEntityName: from.legalName,
          fromClientId: from.clientId,
          toEntityId: to.id,
          toEntityName: to.legalName,
          toClientId: to.clientId,
        });
      }
    }

    const view: Client360View = {
      client,
      ownerPartner: staffRef(client.ownerPartnerMembershipId),
      manager: staffRef(client.managerMembershipId),
      legalEntities,
      registrations,
      contacts,
      relationships,
      engagements,
    };
    return view;
  },

  async listActiveStaff() {
    return staffDirectory.map((s) => ({ ...s }));
  },
};
