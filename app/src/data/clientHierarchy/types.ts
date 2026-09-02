/**
 * IMP-020 — Client-hierarchy domain types (provider-neutral).
 *
 * Mirror the production schema (SCH-04…08, spec 06) one-to-one, in the
 * application-facing camelCase shape. These are the stable DTOs consumers
 * get regardless of the active adapter — no Supabase/PostgREST types
 * (API-ARCH-01).
 *
 * The hierarchy is Firm → Client → LegalEntity → Registration (DEC-F);
 * contacts hang off a client (optionally a specific entity) and
 * client_relationships link two legal entities.
 */
import type { DataSource } from '@/data/source';

// --- Vocabularies (mirror the CHECK constraints in 20260902120000) ---------

export type ClientStatus = 'onboarding' | 'active' | 'inactive' | 'offboarded';
export type ClientRiskRating = 'low' | 'medium' | 'high';

export type LegalEntityType =
  | 'private_limited'
  | 'llp'
  | 'individual'
  | 'partnership'
  | 'trust'
  | 'huf'
  | 'other';
export type LegalEntityStatus = 'active' | 'dormant' | 'dissolved';

export type RegistrationType =
  | 'PAN'
  | 'GSTIN'
  | 'TAN'
  | 'CIN'
  | 'LLPIN'
  | 'DIN'
  | 'PT'
  | 'PF'
  | 'ESI'
  | 'OTHER';
export type RegistrationStatus = 'active' | 'surrendered' | 'expired';

export type ContactStatus = 'active' | 'inactive';

export type RelationType =
  | 'group'
  | 'holding'
  | 'subsidiary'
  | 'director'
  | 'partner'
  | 'promoter'
  | 'related_party'
  | 'family';
export type RelationshipStatus = 'active' | 'ended';

// --- Records (read DTOs) ----------------------------------------------------

/** Client = the commercial relationship (never the legal person). */
export interface ClientRecord {
  id: string;
  firmId: string;
  name: string;
  industry: string | null;
  riskRating: ClientRiskRating | null;
  /** Live firm_memberships.id of the responsible partner (DM-04). */
  ownerPartnerMembershipId: string;
  /** Live firm_memberships.id of the delivery manager, when assigned. */
  managerMembershipId: string | null;
  status: ClientStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string | null;
}

/** LegalEntity = the company/LLP/individual/trust/… the firm serves. */
export interface LegalEntityRecord {
  id: string;
  firmId: string;
  clientId: string;
  entityType: LegalEntityType;
  legalName: string;
  incorporationDate: string | null;
  registeredAddress: string | null;
  status: LegalEntityStatus;
  createdAt: string;
  updatedAt: string | null;
}

/** Registration = a statutory identifier (PAN/GSTIN/TAN/CIN/…) of an entity. */
export interface RegistrationRecord {
  id: string;
  firmId: string;
  legalEntityId: string;
  type: RegistrationType;
  value: string;
  state: string | null;
  /** Establishment/location payload per DM-27. */
  meta: Record<string, unknown> | null;
  validFrom: string | null;
  validTo: string | null;
  status: RegistrationStatus;
  createdAt: string;
  updatedAt: string | null;
}

/** Contact = a person reachable for a client (optionally per entity). */
export interface ContactRecord {
  id: string;
  firmId: string;
  clientId: string;
  legalEntityId: string | null;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string | null;
}

/** ClientRelationship = a typed edge between two legal entities (group tree). */
export interface ClientRelationshipRecord {
  id: string;
  firmId: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: RelationType;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: RelationshipStatus;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Identity-only projection for the billing role (RLS-CLI-04): billing
 * staff get names/statuses for invoicing context without row-level access
 * to the client master. Delivered by the SECURITY DEFINER
 * list_client_identities() RPC, never by widening table SELECT.
 */
export interface ClientIdentity {
  id: string;
  name: string;
  status: ClientStatus;
}

// --- Write inputs -------------------------------------------------------------

export interface CreateClientInput {
  name: string;
  industry?: string | null;
  riskRating?: ClientRiskRating | null;
  ownerPartnerMembershipId: string;
  managerMembershipId?: string | null;
  status?: ClientStatus;
  tags?: string[];
}

/** id/firm_id are immutable; everything else patchable. */
export type UpdateClientInput = Partial<Omit<CreateClientInput, never>>;

export interface CreateLegalEntityInput {
  clientId: string;
  entityType: LegalEntityType;
  legalName: string;
  incorporationDate?: string | null;
  registeredAddress?: string | null;
  status?: LegalEntityStatus;
}

/** entityType is deliberately absent — immutable after creation (SCH-05). */
export type UpdateLegalEntityInput = Partial<
  Omit<CreateLegalEntityInput, 'clientId' | 'entityType'>
>;

export interface CreateRegistrationInput {
  legalEntityId: string;
  type: RegistrationType;
  value: string;
  state?: string | null;
  meta?: Record<string, unknown> | null;
  validFrom?: string | null;
  validTo?: string | null;
  status?: RegistrationStatus;
}

/** type/value are deliberately absent — identifier immutable after creation. */
export type UpdateRegistrationInput = Partial<
  Omit<CreateRegistrationInput, 'legalEntityId' | 'type' | 'value'>
>;

export interface CreateContactInput {
  clientId: string;
  legalEntityId?: string | null;
  name: string;
  roleTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
  status?: ContactStatus;
}

export type UpdateContactInput = Partial<Omit<CreateContactInput, 'clientId'>>;

export interface CreateClientRelationshipInput {
  fromEntityId: string;
  toEntityId: string;
  relationType: RelationType;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status?: RelationshipStatus;
}

export type UpdateClientRelationshipInput = Partial<
  Omit<CreateClientRelationshipInput, 'fromEntityId' | 'toEntityId'>
>;

// --- List filter (API-R0-CLI) ------------------------------------------------

export interface ClientListFilter {
  status?: ClientStatus;
  /** Offboarded clients are excluded by default (DM-04/API-R0-CLI). */
  includeOffboarded?: boolean;
  ownerPartnerMembershipId?: string;
  managerMembershipId?: string;
  tags?: string[];
  riskRating?: ClientRiskRating;
  limit?: number;
  offset?: number;
}

// --- Service contract (API-R0-CLI / ENT / REG / CON) -------------------------

/**
 * The provider-neutral client-hierarchy contract. Two implementations
 * (fixture demo track / Supabase production) sit behind this interface;
 * consumers import `clientHierarchyService` from `@/data` and never know
 * which is active (API-ARCH-02).
 *
 * Error semantics (API-ERR-01/02):
 *   - collection reads return [] when nothing is visible — never an error;
 *   - single-resource reads return null for nonexistent AND inaccessible
 *     ids alike (no existence oracle);
 *   - writes to unknown/inaccessible ids throw ApiError('not_found');
 *   - invariant violations (duplicate registration, entity_type change,
 *     primary contact without email) throw ApiError('conflict');
 *   - RLS denials throw ApiError('unauthorized'); authorization is decided
 *     by the database, never by the adapter.
 */
export interface ClientHierarchyService {
  readonly mode: DataSource;

  listClients(filter?: ClientListFilter): Promise<ClientRecord[]>;
  getClient(clientId: string): Promise<ClientRecord | null>;
  createClient(input: CreateClientInput): Promise<ClientRecord>;
  updateClient(clientId: string, patch: UpdateClientInput): Promise<ClientRecord>;

  /** Billing-role identity projection (RLS-CLI-04), active firm only. */
  listClientIdentities(): Promise<ClientIdentity[]>;

  listLegalEntities(clientId: string): Promise<LegalEntityRecord[]>;
  getLegalEntity(entityId: string): Promise<LegalEntityRecord | null>;
  createLegalEntity(input: CreateLegalEntityInput): Promise<LegalEntityRecord>;
  updateLegalEntity(
    entityId: string,
    patch: UpdateLegalEntityInput,
  ): Promise<LegalEntityRecord>;

  listRegistrations(legalEntityId: string): Promise<RegistrationRecord[]>;
  createRegistration(input: CreateRegistrationInput): Promise<RegistrationRecord>;
  updateRegistration(
    registrationId: string,
    patch: UpdateRegistrationInput,
  ): Promise<RegistrationRecord>;

  listContacts(clientId: string): Promise<ContactRecord[]>;
  createContact(input: CreateContactInput): Promise<ContactRecord>;
  updateContact(contactId: string, patch: UpdateContactInput): Promise<ContactRecord>;

  /** Edges where the entity is EITHER endpoint (group-tree traversal). */
  listClientRelationships(legalEntityId: string): Promise<ClientRelationshipRecord[]>;
  createClientRelationship(
    input: CreateClientRelationshipInput,
  ): Promise<ClientRelationshipRecord>;
  updateClientRelationship(
    relationshipId: string,
    patch: UpdateClientRelationshipInput,
  ): Promise<ClientRelationshipRecord>;
}

