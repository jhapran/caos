/**
 * IMP-021 — Engagement FIXTURE adapter (demo track, MIG-DS-06).
 *
 * Derives engagements from the existing demo fixtures (@/data/clients) —
 * the single source of fixture truth; this file adds no second copy.
 * Everything is in-memory, the module never touches the network, and the
 * Supabase client is never constructed in this mode.
 *
 * Derivation rules (demo-only, documented here because no spec owns them):
 *   - every fixture client gets exactly one engagement covering its tag
 *     list as service lines;
 *   - the fixture's flat ownerId becomes the responsible-partner
 *     membership reference (fixture-mode identity, as in the IMP-020
 *     fixture adapter);
 *   - all derived engagements start active with a signed letter for the
 *     current demo period; in-session mutations can move them through the
 *     DM-SM-03 lifecycle.
 *
 * Mutations are module-local and ephemeral (page reload resets them); the
 * demo overlay for cross-page behavior remains DemoStoreProvider.
 */
import { CLIENTS } from '@/data/clients';
import { ApiError } from '@/data/errors';

import type {
  CreateEngagementInput,
  EngagementListFilter,
  EngagementRecord,
  EngagementService,
  EngagementStatus,
  UpdateEngagementInput,
} from './types';

const DEMO_FIRM_ID = 'demo-fixture-firm';
const DEMO_CREATED_AT = '2026-08-15T00:00:00.000Z';
const DEMO_PERIOD_LABEL = 'FY 2025-26';

interface FixtureStore {
  engagements: EngagementRecord[];
  sequence: number;
}

let store: FixtureStore | null = null;

function buildStore(): FixtureStore {
  const engagements: EngagementRecord[] = CLIENTS.map((c) => ({
    id: `${c.id}-engagement`,
    firmId: DEMO_FIRM_ID,
    clientId: c.id,
    responsiblePartnerMembershipId: c.ownerId,
    serviceLines: [...c.tags],
    letterStatus: 'signed',
    proposedAt: DEMO_CREATED_AT,
    signedAt: DEMO_CREATED_AT,
    periodLabel: DEMO_PERIOD_LABEL,
    status: 'active',
    terminationReason: null,
    createdAt: DEMO_CREATED_AT,
    updatedAt: null,
  }));
  return { engagements, sequence: 0 };
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

function notFound(label: string, id: string): ApiError {
  return new ApiError('not_found', `${label} ${id} not found`);
}

/** DM-SM-03 edges — mirrors the database guard trigger. */
const ALLOWED_TRANSITIONS: Record<EngagementStatus, EngagementStatus[]> = {
  draft: ['proposed'],
  proposed: ['active'],
  active: ['completed', 'terminated'],
  completed: [],
  terminated: [],
};

function assertTransition(from: EngagementStatus, to: EngagementStatus): void {
  if (from !== to && !ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ApiError(
      'conflict',
      `Invalid engagement status transition ${from} -> ${to} (DM-SM-03)`,
    );
  }
}

function applyFilter(rows: EngagementRecord[], filter?: EngagementListFilter): EngagementRecord[] {
  let result = rows;
  if (filter?.clientId) result = result.filter((e) => e.clientId === filter.clientId);
  if (filter?.status) result = result.filter((e) => e.status === filter.status);
  if (filter?.letterStatus) result = result.filter((e) => e.letterStatus === filter.letterStatus);
  if (filter?.responsiblePartnerMembershipId) {
    result = result.filter(
      (e) => e.responsiblePartnerMembershipId === filter.responsiblePartnerMembershipId,
    );
  }
  const offset = filter?.offset ?? 0;
  const end = filter?.limit !== undefined ? offset + filter.limit : undefined;
  return result.slice(offset, end);
}

const copy = (e: EngagementRecord): EngagementRecord => ({ ...e, serviceLines: [...e.serviceLines] });

export const fixtureEngagements: EngagementService = {
  mode: 'fixture',

  async listEngagements(filter) {
    return applyFilter(state().engagements, filter).map(copy);
  },

  async getEngagement(engagementId) {
    const found = state().engagements.find((e) => e.id === engagementId);
    return found ? copy(found) : null;
  },

  async createEngagement(input: CreateEngagementInput) {
    if (!CLIENTS.some((c) => c.id === input.clientId)) {
      throw notFound('Client', input.clientId);
    }
    const status = input.status ?? 'draft';
    // Mirror the termination-reason CHECK (plain rejected input).
    if (status === 'terminated' && !input.terminationReason) {
      throw new ApiError('validation', 'A terminated engagement requires a reason (DM-SM-03)');
    }
    const record: EngagementRecord = {
      id: nextId('engagement'),
      firmId: DEMO_FIRM_ID,
      clientId: input.clientId,
      responsiblePartnerMembershipId: input.responsiblePartnerMembershipId,
      serviceLines: [...(input.serviceLines ?? [])],
      letterStatus: input.letterStatus ?? 'not_started',
      proposedAt: input.proposedAt ?? null,
      signedAt: input.signedAt ?? null,
      periodLabel: input.periodLabel ?? null,
      status,
      terminationReason: input.terminationReason ?? null,
      createdAt: now(),
      updatedAt: null,
    };
    state().engagements.push(record);
    return copy(record);
  },

  async updateEngagement(engagementId, patch: UpdateEngagementInput) {
    const found = state().engagements.find((e) => e.id === engagementId);
    if (!found) throw notFound('Engagement', engagementId);
    const nextStatus = patch.status ?? found.status;
    assertTransition(found.status, nextStatus);
    const nextReason =
      patch.terminationReason !== undefined ? patch.terminationReason : found.terminationReason;
    if (nextStatus === 'terminated' && !nextReason) {
      throw new ApiError('validation', 'A terminated engagement requires a reason (DM-SM-03)');
    }
    Object.assign(found, patch, { updatedAt: now() });
    return copy(found);
  },

  async listEngagementLetterStatuses() {
    return state().engagements.map((e) => ({
      id: e.id,
      clientId: e.clientId,
      letterStatus: e.letterStatus,
    }));
  },
};
