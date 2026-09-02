/**
 * IMP-020 — Client-hierarchy SUPABASE adapter (production path).
 *
 * Plain PostgREST reads/writes under RLS (API-ARCH-03) — no RPC wrappers
 * for row-shaped operations. Authorization is decided by the database on
 * every statement: the active-firm header (injected by the browser
 * client from @/data/context) is selector context only, and the caller's
 * live membership + role + AAL are re-validated server-side (DEC-J,
 * RLS-MECH-01). The only RPC used here is list_client_identities(), the
 * reviewed SECURITY DEFINER projection for the billing role (RLS-CLI-04).
 *
 * Errors are translated once through toApiError() — no Supabase SDK or
 * PostgREST types cross this boundary (API-ARCH-01/02, API-ERR-01).
 */
import { getActiveFirm } from '@/data/context';
import { ApiError, toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type {
  ClientHierarchyService,
  ClientIdentity,
  ClientRecord,
  ClientRelationshipRecord,
  ClientStatus,
  ContactRecord,
  LegalEntityRecord,
  RegistrationRecord,
} from './types';

// --- Row shapes (snake_case, exactly the SCH-04…08 columns) -----------------

interface ClientRow {
  id: string;
  firm_id: string;
  name: string;
  industry: string | null;
  risk_rating: ClientRecord['riskRating'];
  owner_partner_membership_id: string;
  manager_membership_id: string | null;
  status: ClientStatus;
  tags: string[];
  created_at: string;
  updated_at: string | null;
}

interface LegalEntityRow {
  id: string;
  firm_id: string;
  client_id: string;
  entity_type: LegalEntityRecord['entityType'];
  legal_name: string;
  incorporation_date: string | null;
  registered_address: string | null;
  status: LegalEntityRecord['status'];
  created_at: string;
  updated_at: string | null;
}

interface RegistrationRow {
  id: string;
  firm_id: string;
  legal_entity_id: string;
  type: RegistrationRecord['type'];
  value: string;
  state: string | null;
  meta: Record<string, unknown> | null;
  valid_from: string | null;
  valid_to: string | null;
  status: RegistrationRecord['status'];
  created_at: string;
  updated_at: string | null;
}

interface ContactRow {
  id: string;
  firm_id: string;
  client_id: string;
  legal_entity_id: string | null;
  name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  status: ContactRecord['status'];
  created_at: string;
  updated_at: string | null;
}

interface ClientRelationshipRow {
  id: string;
  firm_id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: ClientRelationshipRecord['relationType'];
  effective_from: string | null;
  effective_to: string | null;
  status: ClientRelationshipRecord['status'];
  created_at: string;
  updated_at: string | null;
}

// --- Column projections and mappers ------------------------------------------

const CLIENT_COLUMNS =
  'id, firm_id, name, industry, risk_rating, owner_partner_membership_id, ' +
  'manager_membership_id, status, tags, created_at, updated_at';
const ENTITY_COLUMNS =
  'id, firm_id, client_id, entity_type, legal_name, incorporation_date, ' +
  'registered_address, status, created_at, updated_at';
const REGISTRATION_COLUMNS =
  'id, firm_id, legal_entity_id, type, value, state, meta, valid_from, valid_to, ' +
  'status, created_at, updated_at';
const CONTACT_COLUMNS =
  'id, firm_id, client_id, legal_entity_id, name, role_title, email, phone, ' +
  'is_primary, status, created_at, updated_at';
const RELATIONSHIP_COLUMNS =
  'id, firm_id, from_entity_id, to_entity_id, relation_type, effective_from, ' +
  'effective_to, status, created_at, updated_at';

const toClient = (r: ClientRow): ClientRecord => ({
  id: r.id,
  firmId: r.firm_id,
  name: r.name,
  industry: r.industry,
  riskRating: r.risk_rating,
  ownerPartnerMembershipId: r.owner_partner_membership_id,
  managerMembershipId: r.manager_membership_id,
  status: r.status,
  tags: r.tags,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toEntity = (r: LegalEntityRow): LegalEntityRecord => ({
  id: r.id,
  firmId: r.firm_id,
  clientId: r.client_id,
  entityType: r.entity_type,
  legalName: r.legal_name,
  incorporationDate: r.incorporation_date,
  registeredAddress: r.registered_address,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRegistration = (r: RegistrationRow): RegistrationRecord => ({
  id: r.id,
  firmId: r.firm_id,
  legalEntityId: r.legal_entity_id,
  type: r.type,
  value: r.value,
  state: r.state,
  meta: r.meta,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toContact = (r: ContactRow): ContactRecord => ({
  id: r.id,
  firmId: r.firm_id,
  clientId: r.client_id,
  legalEntityId: r.legal_entity_id,
  name: r.name,
  roleTitle: r.role_title,
  email: r.email,
  phone: r.phone,
  isPrimary: r.is_primary,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRelationship = (r: ClientRelationshipRow): ClientRelationshipRecord => ({
  id: r.id,
  firmId: r.firm_id,
  fromEntityId: r.from_entity_id,
  toEntityId: r.to_entity_id,
  relationType: r.relation_type,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// --- Write helpers -------------------------------------------------------------

/**
 * Tenant key for inserts. firm_id is NOT NULL and every INSERT policy
 * requires firm_id = req_active_firm(), so the value must come from the
 * validated selector context. The header itself is injected by the
 * browser client; here we fail fast when no firm is selected rather than
 * shipping a row the database would reject anyway.
 */
function requireActiveFirm(): string {
  const firmId = getActiveFirm();
  if (!firmId) {
    throw new ApiError(
      'validation',
      'No active firm selected — select a firm workspace before writing (RLS-CTX-01)',
    );
  }
  return firmId;
}

/** Drop undefined keys so patches only touch supplied columns. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const supabaseClientHierarchy: ClientHierarchyService = {
  mode: 'supabase',

  async listClients(filter) {
    let query = getSupabaseClient().from('clients').select(CLIENT_COLUMNS).order('name');
    if (filter?.status) {
      query = query.eq('status', filter.status);
    } else if (!filter?.includeOffboarded) {
      query = query.neq('status', 'offboarded');
    }
    if (filter?.ownerPartnerMembershipId) {
      query = query.eq('owner_partner_membership_id', filter.ownerPartnerMembershipId);
    }
    if (filter?.managerMembershipId) {
      query = query.eq('manager_membership_id', filter.managerMembershipId);
    }
    if (filter?.riskRating) query = query.eq('risk_rating', filter.riskRating);
    if (filter?.tags?.length) query = query.contains('tags', filter.tags);
    if (filter?.limit !== undefined || filter?.offset !== undefined) {
      const from = filter?.offset ?? 0;
      const to = from + (filter?.limit ?? 50) - 1;
      query = query.range(from, to);
    }
    const { data, error } = await query;
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ClientRow[]).map(toClient);
  },

  async getClient(clientId) {
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq('id', clientId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toClient(data as unknown as ClientRow) : null;
  },

  async createClient(input) {
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .insert({
        firm_id: requireActiveFirm(),
        name: input.name,
        industry: input.industry ?? null,
        risk_rating: input.riskRating ?? null,
        owner_partner_membership_id: input.ownerPartnerMembershipId,
        manager_membership_id: input.managerMembershipId ?? null,
        status: input.status ?? 'onboarding',
        tags: input.tags ?? [],
      })
      .select(CLIENT_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toClient(data as unknown as ClientRow);
  },

  async updateClient(clientId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('clients')
      .update(
        compact({
          name: patch.name,
          industry: patch.industry,
          risk_rating: patch.riskRating,
          owner_partner_membership_id: patch.ownerPartnerMembershipId,
          manager_membership_id: patch.managerMembershipId,
          status: patch.status,
          tags: patch.tags,
        }),
      )
      .eq('id', clientId)
      .select(CLIENT_COLUMNS)
      .single();
    // 0 rows (unknown OR inaccessible id) → PGRST116 → not_found (API-ERR-02)
    if (error) throw toApiError(error);
    return toClient(data as unknown as ClientRow);
  },

  async listClientIdentities() {
    const { data, error } = await getSupabaseClient().rpc('list_client_identities', {
      p_firm_id: requireActiveFirm(),
    });
    if (error) throw toApiError(error);
    return ((data ?? []) as { id: string; name: string; status: ClientStatus }[]).map(
      (r): ClientIdentity => ({ id: r.id, name: r.name, status: r.status }),
    );
  },

  async listLegalEntities(clientId) {
    const { data, error } = await getSupabaseClient()
      .from('legal_entities')
      .select(ENTITY_COLUMNS)
      .eq('client_id', clientId)
      .order('legal_name');
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as LegalEntityRow[]).map(toEntity);
  },

  async getLegalEntity(entityId) {
    const { data, error } = await getSupabaseClient()
      .from('legal_entities')
      .select(ENTITY_COLUMNS)
      .eq('id', entityId)
      .maybeSingle();
    if (error) throw toApiError(error);
    return data ? toEntity(data as unknown as LegalEntityRow) : null;
  },

  async createLegalEntity(input) {
    const { data, error } = await getSupabaseClient()
      .from('legal_entities')
      .insert({
        firm_id: requireActiveFirm(),
        client_id: input.clientId,
        entity_type: input.entityType,
        legal_name: input.legalName,
        incorporation_date: input.incorporationDate ?? null,
        registered_address: input.registeredAddress ?? null,
        status: input.status ?? 'active',
      })
      .select(ENTITY_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toEntity(data as unknown as LegalEntityRow);
  },

  async updateLegalEntity(entityId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('legal_entities')
      .update(
        compact({
          legal_name: patch.legalName,
          incorporation_date: patch.incorporationDate,
          registered_address: patch.registeredAddress,
          status: patch.status,
        }),
      )
      .eq('id', entityId)
      .select(ENTITY_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toEntity(data as unknown as LegalEntityRow);
  },

  async listRegistrations(legalEntityId) {
    const { data, error } = await getSupabaseClient()
      .from('registrations')
      .select(REGISTRATION_COLUMNS)
      .eq('legal_entity_id', legalEntityId)
      .order('type');
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as RegistrationRow[]).map(toRegistration);
  },

  async createRegistration(input) {
    const { data, error } = await getSupabaseClient()
      .from('registrations')
      .insert({
        firm_id: requireActiveFirm(),
        legal_entity_id: input.legalEntityId,
        type: input.type,
        value: input.value,
        state: input.state ?? null,
        meta: input.meta ?? null,
        valid_from: input.validFrom ?? null,
        valid_to: input.validTo ?? null,
        status: input.status ?? 'active',
      })
      .select(REGISTRATION_COLUMNS)
      .single();
    // Duplicate (firm, type, value) → 23505 → conflict (API-R0-REG)
    if (error) throw toApiError(error);
    return toRegistration(data as unknown as RegistrationRow);
  },

  async updateRegistration(registrationId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('registrations')
      .update(
        compact({
          state: patch.state,
          meta: patch.meta,
          valid_from: patch.validFrom,
          valid_to: patch.validTo,
          status: patch.status,
        }),
      )
      .eq('id', registrationId)
      .select(REGISTRATION_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toRegistration(data as unknown as RegistrationRow);
  },

  async listContacts(clientId) {
    const { data, error } = await getSupabaseClient()
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .eq('client_id', clientId)
      .order('name');
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ContactRow[]).map(toContact);
  },

  async createContact(input) {
    const { data, error } = await getSupabaseClient()
      .from('contacts')
      .insert({
        firm_id: requireActiveFirm(),
        client_id: input.clientId,
        legal_entity_id: input.legalEntityId ?? null,
        name: input.name,
        role_title: input.roleTitle ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        is_primary: input.isPrimary ?? false,
        status: input.status ?? 'active',
      })
      .select(CONTACT_COLUMNS)
      .single();
    // Primary without email → 23514 → conflict (SCH-08)
    if (error) throw toApiError(error);
    return toContact(data as unknown as ContactRow);
  },

  async updateContact(contactId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('contacts')
      .update(
        compact({
          legal_entity_id: patch.legalEntityId,
          name: patch.name,
          role_title: patch.roleTitle,
          email: patch.email,
          phone: patch.phone,
          is_primary: patch.isPrimary,
          status: patch.status,
        }),
      )
      .eq('id', contactId)
      .select(CONTACT_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toContact(data as unknown as ContactRow);
  },

  async listClientRelationships(legalEntityId) {
    const { data, error } = await getSupabaseClient()
      .from('client_relationships')
      .select(RELATIONSHIP_COLUMNS)
      .or(`from_entity_id.eq.${legalEntityId},to_entity_id.eq.${legalEntityId}`);
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as ClientRelationshipRow[]).map(toRelationship);
  },

  async createClientRelationship(input) {
    const { data, error } = await getSupabaseClient()
      .from('client_relationships')
      .insert({
        firm_id: requireActiveFirm(),
        from_entity_id: input.fromEntityId,
        to_entity_id: input.toEntityId,
        relation_type: input.relationType,
        effective_from: input.effectiveFrom ?? null,
        effective_to: input.effectiveTo ?? null,
        status: input.status ?? 'active',
      })
      .select(RELATIONSHIP_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toRelationship(data as unknown as ClientRelationshipRow);
  },

  async updateClientRelationship(relationshipId, patch) {
    const { data, error } = await getSupabaseClient()
      .from('client_relationships')
      .update(
        compact({
          relation_type: patch.relationType,
          effective_from: patch.effectiveFrom,
          effective_to: patch.effectiveTo,
          status: patch.status,
        }),
      )
      .eq('id', relationshipId)
      .select(RELATIONSHIP_COLUMNS)
      .single();
    if (error) throw toApiError(error);
    return toRelationship(data as unknown as ClientRelationshipRow);
  },
};
