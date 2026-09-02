/**
 * IMP-020 — Client-hierarchy FIXTURE adapter (demo track, MIG-DS-06).
 *
 * Derives the Firm → Client → LegalEntity → Registration hierarchy from the
 * existing demo fixtures (@/data/clients) — the single source of fixture
 * truth; this file adds no second copy. Everything is in-memory, the
 * module never touches the network, and the Supabase client is never
 * constructed in this mode.
 *
 * Derivation rules (demo-only, documented here because no spec owns them):
 *   - every fixture client gets exactly one default legal entity (DEC-F:
 *     the entity carries the legal identity; the client stays commercial);
 *   - the fixture's flat entityType string maps onto the SCH-05
 *     vocabulary; 'Ltd' (public limited) has no vocabulary entry and
 *     becomes 'other';
 *   - PAN/GSTIN/CIN fields become registrations; GSTIN state derives from
 *     the two-digit statutory prefix present in the fixture set
 *     (27 Maharashtra, 30 Goa, 26 Dadra & Nagar Haveli and Daman & Diu);
 *   - the demo fixtures carry no contacts or group edges, so those
 *     collections start empty and only reflect in-session mutations.
 *
 * Mutations are module-local and ephemeral (page reload resets them); the
 * demo overlay for cross-page behavior remains DemoStoreProvider.
 */
import { CLIENTS } from '@/data/clients';
import { ApiError } from '@/data/errors';

import type {
  ClientHierarchyService,
  ClientListFilter,
  ClientRecord,
  ClientRelationshipRecord,
  ContactRecord,
  LegalEntityRecord,
  LegalEntityType,
  RegistrationRecord,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';
const DEMO_CREATED_AT = '2026-08-15T00:00:00.000Z';

const ENTITY_TYPE_MAP: Record<string, LegalEntityType> = {
  'Pvt Ltd': 'private_limited',
  LLP: 'llp',
  Partnership: 'partnership',
  Proprietorship: 'individual',
  Trust: 'trust',
  Ltd: 'other',
};

const GSTIN_STATE_MAP: Record<string, string> = {
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '30': 'Goa',
};

interface FixtureStore {
  clients: ClientRecord[];
  entities: LegalEntityRecord[];
  registrations: RegistrationRecord[];
  contacts: ContactRecord[];
  relationships: ClientRelationshipRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  const clients: ClientRecord[] = [];
  const entities: LegalEntityRecord[] = [];
  const registrations: RegistrationRecord[] = [];

  for (const c of CLIENTS) {
    clients.push({
      id: c.id,
      firmId: DEMO_FIRM_ID,
      name: c.name,
      industry: c.industry ?? null,
      riskRating: null,
      ownerPartnerMembershipId: c.ownerId,
      managerMembershipId: null,
      status: 'active',
      tags: [...c.tags],
      createdAt: DEMO_CREATED_AT,
      updatedAt: null,
    });

    const entityId = `${c.id}-entity`;
    entities.push({
      id: entityId,
      firmId: DEMO_FIRM_ID,
      clientId: c.id,
      entityType: ENTITY_TYPE_MAP[c.entityType] ?? 'other',
      legalName: c.name,
      incorporationDate: null,
      registeredAddress: c.city ?? null,
      status: 'active',
      createdAt: DEMO_CREATED_AT,
      updatedAt: null,
    });

    if (c.pan) {
      registrations.push({
        id: `${c.id}-pan`,
        firmId: DEMO_FIRM_ID,
        legalEntityId: entityId,
        type: 'PAN',
        value: c.pan,
        state: null,
        meta: null,
        validFrom: null,
        validTo: null,
        status: 'active',
        createdAt: DEMO_CREATED_AT,
        updatedAt: null,
      });
    }
    if (c.gstin) {
      registrations.push({
        id: `${c.id}-gstin`,
        firmId: DEMO_FIRM_ID,
        legalEntityId: entityId,
        type: 'GSTIN',
        value: c.gstin,
        state: GSTIN_STATE_MAP[c.gstin.slice(0, 2)] ?? null,
        meta: null,
        validFrom: null,
        validTo: null,
        status: 'active',
        createdAt: DEMO_CREATED_AT,
        updatedAt: null,
      });
    }
    if (c.cin) {
      registrations.push({
        id: `${c.id}-cin`,
        firmId: DEMO_FIRM_ID,
        legalEntityId: entityId,
        type: 'CIN',
        value: c.cin,
        state: null,
        meta: null,
        validFrom: null,
        validTo: null,
        status: 'active',
        createdAt: DEMO_CREATED_AT,
        updatedAt: null,
      });
    }
  }

  return { clients, entities, registrations, contacts: [], relationships: [], sequence: 0 };
}

function state(): FixtureStore {
  if (!store) store = buildStore();
  return store;
}

function nextId(label: string): string {
  const s = state();
  s.sequence += 1;
  return `fixture-${label}-${s.sequence}`;
}

const now = () => new Date().toISOString();

function applyClientFilter(clients: ClientRecord[], filter?: ClientListFilter): ClientRecord[] {
  let rows = clients;
  if (filter?.status) {
    rows = rows.filter((c) => c.status === filter.status);
  } else if (!filter?.includeOffboarded) {
    rows = rows.filter((c) => c.status !== 'offboarded');
  }
  if (filter?.ownerPartnerMembershipId) {
    rows = rows.filter((c) => c.ownerPartnerMembershipId === filter.ownerPartnerMembershipId);
  }
  if (filter?.managerMembershipId) {
    rows = rows.filter((c) => c.managerMembershipId === filter.managerMembershipId);
  }
  if (filter?.riskRating) {
    rows = rows.filter((c) => c.riskRating === filter.riskRating);
  }
  if (filter?.tags?.length) {
    const wanted = filter.tags;
    rows = rows.filter((c) => wanted.every((t) => c.tags.includes(t)));
  }
  rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const offset = filter?.offset ?? 0;
  const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
  return rows.slice(offset, end);
}

function notFound(label: string, id: string): ApiError {
  return new ApiError('not_found', `${label} ${id} not found`);
}

export const fixtureClientHierarchy: ClientHierarchyService = {
  mode: 'fixture',

  async listClients(filter) {
    return applyClientFilter(state().clients, filter).map((c) => ({ ...c, tags: [...c.tags] }));
  },

  async getClient(clientId) {
    const found = state().clients.find((c) => c.id === clientId);
    return found ? { ...found, tags: [...found.tags] } : null;
  },

  async createClient(input) {
    const record: ClientRecord = {
      id: nextId('client'),
      firmId: DEMO_FIRM_ID,
      name: input.name,
      industry: input.industry ?? null,
      riskRating: input.riskRating ?? null,
      ownerPartnerMembershipId: input.ownerPartnerMembershipId,
      managerMembershipId: input.managerMembershipId ?? null,
      status: input.status ?? 'onboarding',
      tags: [...(input.tags ?? [])],
      createdAt: now(),
      updatedAt: null,
    };
    state().clients.push(record);
    return { ...record, tags: [...record.tags] };
  },

  async updateClient(clientId, patch) {
    const found = state().clients.find((c) => c.id === clientId);
    if (!found) throw notFound('Client', clientId);
    Object.assign(found, patch, { updatedAt: now() });
    return { ...found, tags: [...found.tags] };
  },

  async listClientIdentities() {
    return state().clients.map((c) => ({ id: c.id, name: c.name, status: c.status }));
  },

  async listLegalEntities(clientId) {
    return state().entities.filter((e) => e.clientId === clientId).map((e) => ({ ...e }));
  },

  async getLegalEntity(entityId) {
    const found = state().entities.find((e) => e.id === entityId);
    return found ? { ...found } : null;
  },

  async createLegalEntity(input) {
    if (!state().clients.some((c) => c.id === input.clientId)) {
      throw notFound('Client', input.clientId);
    }
    const record: LegalEntityRecord = {
      id: nextId('entity'),
      firmId: DEMO_FIRM_ID,
      clientId: input.clientId,
      entityType: input.entityType,
      legalName: input.legalName,
      incorporationDate: input.incorporationDate ?? null,
      registeredAddress: input.registeredAddress ?? null,
      status: input.status ?? 'active',
      createdAt: now(),
      updatedAt: null,
    };
    state().entities.push(record);
    return { ...record };
  },

  async updateLegalEntity(entityId, patch) {
    const found = state().entities.find((e) => e.id === entityId);
    if (!found) throw notFound('Legal entity', entityId);
    Object.assign(found, patch, { updatedAt: now() });
    return { ...found };
  },

  async listRegistrations(legalEntityId) {
    return state()
      .registrations.filter((r) => r.legalEntityId === legalEntityId)
      .map((r) => ({ ...r }));
  },

  async createRegistration(input) {
    if (!state().entities.some((e) => e.id === input.legalEntityId)) {
      throw notFound('Legal entity', input.legalEntityId);
    }
    // Mirror the schema invariants the database enforces in supabase mode:
    // (firm, type, value) uniqueness and GSTIN-requires-state (DM-06).
    if (
      state().registrations.some((r) => r.type === input.type && r.value === input.value)
    ) {
      throw new ApiError(
        'conflict',
        `Registration ${input.type} ${input.value} already exists`,
      );
    }
    if (input.type === 'GSTIN' && !input.state) {
      throw new ApiError('validation', 'GSTIN registrations require a state (DM-06)');
    }
    const record: RegistrationRecord = {
      id: nextId('registration'),
      firmId: DEMO_FIRM_ID,
      legalEntityId: input.legalEntityId,
      type: input.type,
      value: input.value,
      state: input.state ?? null,
      meta: input.meta ?? null,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      status: input.status ?? 'active',
      createdAt: now(),
      updatedAt: null,
    };
    state().registrations.push(record);
    return { ...record };
  },

  async updateRegistration(registrationId, patch) {
    const found = state().registrations.find((r) => r.id === registrationId);
    if (!found) throw notFound('Registration', registrationId);
    Object.assign(found, patch, { updatedAt: now() });
    return { ...found };
  },

  async listContacts(clientId) {
    return state().contacts.filter((c) => c.clientId === clientId).map((c) => ({ ...c }));
  },

  async createContact(input) {
    if (!state().clients.some((c) => c.id === input.clientId)) {
      throw notFound('Client', input.clientId);
    }
    // Mirror SCH-08: a primary contact must be emailable.
    if (input.isPrimary && !input.email) {
      throw new ApiError('validation', 'A primary contact requires an email address (SCH-08)');
    }
    const record: ContactRecord = {
      id: nextId('contact'),
      firmId: DEMO_FIRM_ID,
      clientId: input.clientId,
      legalEntityId: input.legalEntityId ?? null,
      name: input.name,
      roleTitle: input.roleTitle ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      isPrimary: input.isPrimary ?? false,
      status: input.status ?? 'active',
      createdAt: now(),
      updatedAt: null,
    };
    state().contacts.push(record);
    return { ...record };
  },

  async updateContact(contactId, patch) {
    const found = state().contacts.find((c) => c.id === contactId);
    if (!found) throw notFound('Contact', contactId);
    const next = { ...found, ...patch };
    if (next.isPrimary && !next.email) {
      throw new ApiError('validation', 'A primary contact requires an email address (SCH-08)');
    }
    Object.assign(found, patch, { updatedAt: now() });
    return { ...found };
  },

  async listClientRelationships(legalEntityId) {
    return state()
      .relationships.filter(
        (r) => r.fromEntityId === legalEntityId || r.toEntityId === legalEntityId,
      )
      .map((r) => ({ ...r }));
  },

  async createClientRelationship(input) {
    const s = state();
    for (const id of [input.fromEntityId, input.toEntityId]) {
      if (!s.entities.some((e) => e.id === id)) throw notFound('Legal entity', id);
    }
    if (input.fromEntityId === input.toEntityId) {
      throw new ApiError('validation', 'A relationship cannot loop back to the same entity');
    }
    const record: ClientRelationshipRecord = {
      id: nextId('relationship'),
      firmId: DEMO_FIRM_ID,
      fromEntityId: input.fromEntityId,
      toEntityId: input.toEntityId,
      relationType: input.relationType,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      status: input.status ?? 'active',
      createdAt: now(),
      updatedAt: null,
    };
    s.relationships.push(record);
    return { ...record };
  },

  async updateClientRelationship(relationshipId, patch) {
    const found = state().relationships.find((r) => r.id === relationshipId);
    if (!found) throw notFound('Client relationship', relationshipId);
    Object.assign(found, patch, { updatedAt: now() });
    return { ...found };
  },
};
