/**
 * IMP-022 — Client 360 composite read contract (provider-neutral).
 *
 * Spec basis: `07` API-R0-CLI ("Client 360 composite read (DM-X-02)") and
 * the fetchClient EVOLVE row ("Composite read: client + entities +
 * registrations + contacts + engagements …; one contract, several
 * underlying reads"). This is an APPLICATION-side composition over the
 * IMP-020/021 services plus plain RLS reads (API-ARCH-03) — deliberately
 * no SECURITY DEFINER aggregate RPC (API-SEC: RLS stays the filtering
 * boundary, and the composite can never see a row the caller's table RLS
 * would hide).
 *
 * Deferred content (NOT in this DTO, per spec sequencing): compliance
 * summary (IMP-030+), documents, communications, financial snapshot.
 * `02` DM-15 approves a placeholder communications tab for R0; the other
 * tabs render explicit deferred states in the UI layer.
 */
import type {
  ClientRecord,
  ClientRelationshipRecord,
  ContactRecord,
  LegalEntityRecord,
  RegistrationRecord,
} from '@/data/clientHierarchy';
import type { EngagementRecord } from '@/data/engagements';
import type { DataSource } from '@/data/source';
import type { MembershipRole } from '@/data/tenancy';

/**
 * A live firm membership paired with its display name. Names come from
 * `profiles` via RLS-PRF-01 (shared-firm display fields) — never from
 * caller input, and membership UUIDs are internal identifiers, not
 * user-facing names (PRD §18 overview shows partner/manager NAMES).
 */
export interface StaffRef {
  membershipId: string;
  fullName: string;
  role: MembershipRole;
}

/**
 * A relationship edge with both endpoint entity names resolved through
 * authorized reads. For a manager, RLS (IMP-020 closure decision A)
 * already guarantees both endpoints are in-portfolio before the edge is
 * returned — name resolution can never widen that scope.
 */
export interface Client360Relationship {
  id: ClientRelationshipRecord['id'];
  relationType: ClientRelationshipRecord['relationType'];
  status: ClientRelationshipRecord['status'];
  effectiveFrom: ClientRelationshipRecord['effectiveFrom'];
  effectiveTo: ClientRelationshipRecord['effectiveTo'];
  fromEntityId: string;
  fromEntityName: string;
  fromClientId: string;
  toEntityId: string;
  toEntityName: string;
  toClientId: string;
}

/** Engagement row plus the responsible partner's display name. */
export interface Client360Engagement {
  engagement: EngagementRecord;
  responsiblePartnerName: string | null;
}

/**
 * The composite Client 360 read model. Every collection is exactly what
 * the caller's RLS scope returns — an empty array is a normal result
 * (API-ERR-02), never an error.
 */
export interface Client360View {
  client: ClientRecord;
  ownerPartner: StaffRef | null;
  manager: StaffRef | null;
  legalEntities: LegalEntityRecord[];
  registrations: RegistrationRecord[];
  contacts: ContactRecord[];
  relationships: Client360Relationship[];
  engagements: Client360Engagement[];
}

/**
 * The Client 360 contract. Error semantics (API-ERR-01/02):
 *   - getClient360 returns null for nonexistent AND inaccessible client
 *     ids alike — the composite is never an existence oracle;
 *   - provider failures throw ApiError via the shared taxonomy.
 */
export interface Client360Service {
  readonly mode: DataSource;

  getClient360(clientId: string): Promise<Client360View | null>;

  /**
   * Active-firm staff directory (membership id + display name + role).
   * Used by create forms (owner-partner/manager selects) and for name
   * resolution; backed by firm_memberships ⋈ profiles under RLS
   * (spec 07 getTeam EVOLVE row).
   */
  listActiveStaff(): Promise<StaffRef[]>;
}
