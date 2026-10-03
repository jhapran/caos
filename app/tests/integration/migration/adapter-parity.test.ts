/**
 * IMP-070 — TEST-MIG-02 / MIG-VAL-03: adapter parity across all 12 data
 * domains. The SAME @/data service-contract read surface is exercised against
 * BOTH adapters (the demo-track fixture adapter and the production Supabase
 * adapter, imported directly as singletons) and the DTO SHAPES are compared —
 * never the values (the demo dataset and the live suite dataset differ by
 * design).
 *
 * Provider-neutrality evidence-by-construction: this file imports ONLY
 * '@/data…' adapter paths, '@/data/context' and the '@/lib/supabaseClient'
 * test-harness client — no UI/component import exists anywhere in the suite.
 *
 * Shape matcher contract (MIG-VAL-03): object KEY SETS must be identical; for
 * each key, if BOTH values are non-null the descriptors must match (null on
 * either side is tolerated — nullable columns); arrays compare element shapes
 * when BOTH are non-empty (an empty collection on one side is a truthful
 * data-volume difference, not a contract difference).
 *
 * Anchors: the fixture side derives from the barrel's demo fixture data
 * (CLIENTS[0] and each adapter's own first rows); the supabase side uses the
 * suite-seeded rows (fixture-setup.mjs, dedicated 70000000-… firm). Every
 * supabase-side anchor is asserted non-null/present so the parity comparison
 * is never vacuous. The two billing-role projection RPCs
 * (list_client_identities / list_engagement_letter_statuses — the RPCs
 * require role='billing', see the IMP-020/021 migrations) are called on the
 * supabase side under a billing.a session; the fixture side serves its
 * equivalent projection without a role concept.
 *
 * The two subscription methods (review.subscribeReviewQueue,
 * alerts.subscribeAlerts) are asserted as arity-1 functions on BOTH adapters
 * but the supabase side is deliberately NOT invoked: it opens the realtime
 * broadcast / API-RT-07 polling transport. Bounded choice recorded per the
 * package instruction — transport differs by design; contract shape parity
 * only. Transport behavior is owned by the review/alerts/realtime suites.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLIENTS } from '@/data';
import { fixtureAlerts } from '@/data/alerts/fixture';
import { supabaseAlerts } from '@/data/alerts/supabase';
import { fixtureClient360 } from '@/data/client360/fixture';
import { supabaseClient360 } from '@/data/client360/supabase';
import { fixtureClientHierarchy } from '@/data/clientHierarchy/fixture';
import { supabaseClientHierarchy } from '@/data/clientHierarchy/supabase';
import { fixtureComplianceInstances } from '@/data/complianceInstances/fixture';
import { supabaseComplianceInstances } from '@/data/complianceInstances/supabase';
import { fixtureComplianceRules } from '@/data/complianceRules/fixture';
import { supabaseComplianceRules } from '@/data/complianceRules/supabase';
import { clearActiveFirm, setActiveFirm } from '@/data/context';
import { fixtureDashboard } from '@/data/dashboard/fixture';
import { supabaseDashboard } from '@/data/dashboard/supabase';
import { fixtureDeadlines } from '@/data/deadlines/fixture';
import { supabaseDeadlines } from '@/data/deadlines/supabase';
import { fixtureEngagements } from '@/data/engagements/fixture';
import { supabaseEngagements } from '@/data/engagements/supabase';
import { fixtureMyWork } from '@/data/mywork/fixture';
import { supabaseMyWork } from '@/data/mywork/supabase';
import { fixtureReview } from '@/data/review/fixture';
import { supabaseReview } from '@/data/review/supabase';
import { fixtureSearch } from '@/data/search/fixture';
import { supabaseSearch } from '@/data/search/supabase';
// NAMING HAZARD (IMP-040): '@/data/tasks' resolves to the LEGACY flat fixture
// module — the live tasks domain is the folder, addressed explicitly.
import { fixtureTasks } from '@/data/tasks/fixture';
import { supabaseTasks } from '@/data/tasks/supabase';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { PASSWORD, userEmail } from '../helpers.mjs';
import {
  C,
  CCP,
  E,
  ENG,
  I,
  SUITE_CLIENT_NAME,
  SUITE_FIRM,
  SYS_ITR,
  SYS_ITR_VERSION,
  T,
  cleanMigrationFixture,
  seedMigrationFixture,
} from './fixture-setup.mjs';

// ---------------------------------------------------------------------------
// Shape descriptor + tolerant matcher (see the header contract)
// ---------------------------------------------------------------------------

type Shape =
  | { kind: 'null' }
  | { kind: 'primitive'; valueType: string }
  | { kind: 'array'; element: Shape | null } // element null = empty array
  | { kind: 'object'; keys: Record<string, Shape> };

function shapeOf(value: unknown): Shape {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) {
    return { kind: 'array', element: value.length > 0 ? shapeOf(value[0]) : null };
  }
  if (typeof value === 'object') {
    const keys: Record<string, Shape> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      keys[key] = shapeOf((value as Record<string, unknown>)[key]);
    }
    return { kind: 'object', keys };
  }
  return { kind: 'primitive', valueType: typeof value };
}

function assertShapeParity(fixtureShape: Shape, supabaseShape: Shape, path: string): void {
  // Null on either side is tolerated (nullable columns) — only two non-null
  // values must agree.
  if (fixtureShape.kind === 'null' || supabaseShape.kind === 'null') return;
  expect(supabaseShape.kind, `${path}: descriptor kind`).toBe(fixtureShape.kind);
  if (fixtureShape.kind === 'primitive' && supabaseShape.kind === 'primitive') {
    expect(supabaseShape.valueType, path).toBe(fixtureShape.valueType);
    return;
  }
  if (fixtureShape.kind === 'array' && supabaseShape.kind === 'array') {
    if (fixtureShape.element !== null && supabaseShape.element !== null) {
      assertShapeParity(fixtureShape.element, supabaseShape.element, `${path}[0]`);
    }
    return;
  }
  if (fixtureShape.kind === 'object' && supabaseShape.kind === 'object') {
    expect(Object.keys(supabaseShape.keys), `${path}: key set`).toEqual(Object.keys(fixtureShape.keys));
    for (const key of Object.keys(fixtureShape.keys)) {
      assertShapeParity(fixtureShape.keys[key], supabaseShape.keys[key], `${path}.${key}`);
    }
  }
}

/** Shape-compare one contract call's DTO across the two adapters. */
function expectParity(fixtureValue: unknown, supabaseValue: unknown, label: string): void {
  assertShapeParity(shapeOf(fixtureValue), shapeOf(supabaseValue), label);
}

/** The adapter proof path (dashboard/deadline-suite precedent): an
 *  authenticated password-grant session on the shared client + the untrusted
 *  active-firm selector. */
async function supabaseAs(userKey: string): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email: userEmail(userKey),
    password: PASSWORD,
  });
  expect(error).toBeNull();
  setActiveFirm(SUITE_FIRM);
}

// The non-vacuity table: exactly the 12 production data domains.
const DOMAINS = [
  { name: 'clientHierarchy', fixtureAdapter: fixtureClientHierarchy, supabaseAdapter: supabaseClientHierarchy },
  { name: 'engagements', fixtureAdapter: fixtureEngagements, supabaseAdapter: supabaseEngagements },
  { name: 'client360', fixtureAdapter: fixtureClient360, supabaseAdapter: supabaseClient360 },
  { name: 'complianceRules', fixtureAdapter: fixtureComplianceRules, supabaseAdapter: supabaseComplianceRules },
  { name: 'complianceInstances', fixtureAdapter: fixtureComplianceInstances, supabaseAdapter: supabaseComplianceInstances },
  { name: 'tasks', fixtureAdapter: fixtureTasks, supabaseAdapter: supabaseTasks },
  { name: 'review', fixtureAdapter: fixtureReview, supabaseAdapter: supabaseReview },
  { name: 'alerts', fixtureAdapter: fixtureAlerts, supabaseAdapter: supabaseAlerts },
  { name: 'mywork', fixtureAdapter: fixtureMyWork, supabaseAdapter: supabaseMyWork },
  { name: 'dashboard', fixtureAdapter: fixtureDashboard, supabaseAdapter: supabaseDashboard },
  { name: 'search', fixtureAdapter: fixtureSearch, supabaseAdapter: supabaseSearch },
  { name: 'deadlines', fixtureAdapter: fixtureDeadlines, supabaseAdapter: supabaseDeadlines },
];

beforeAll(async () => {
  seedMigrationFixture();
  await supabaseAs('USER_A_PARTNER');
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanMigrationFixture();
});

describe('TEST-MIG-02 — the 12-domain adapter inventory is complete and symmetric', () => {
  it('exactly 12 domains, each with a fixture AND a supabase adapter', () => {
    expect(DOMAINS).toHaveLength(12);
    for (const d of DOMAINS) {
      expect(d.fixtureAdapter, d.name).toBeDefined();
      expect(d.supabaseAdapter, d.name).toBeDefined();
    }
  });

  it('every adapter declares its mode truthfully (fixture vs supabase)', () => {
    for (const d of DOMAINS) {
      expect(d.fixtureAdapter.mode, d.name).toBe('fixture');
      expect(d.supabaseAdapter.mode, d.name).toBe('supabase');
    }
  });

  it('the method sets are IDENTICAL between the two adapters of each domain (MIG-VAL-03 surface symmetry)', () => {
    for (const d of DOMAINS) {
      expect(Object.keys(d.supabaseAdapter).sort(), d.name).toEqual(Object.keys(d.fixtureAdapter).sort());
    }
  });
});

describe('TEST-MIG-02 — clientHierarchy parity', () => {
  it('listClients / getClient / getLegalEntity', async () => {
    const fClients = await fixtureClientHierarchy.listClients();
    const sClients = await supabaseClientHierarchy.listClients();
    expectParity(fClients, sClients, 'clientHierarchy.listClients');
    expect(fClients.length).toBeGreaterThan(0);
    expect(sClients.map((c) => c.id)).toEqual([C.c1]);

    const fClient = await fixtureClientHierarchy.getClient(CLIENTS[0].id);
    const sClient = await supabaseClientHierarchy.getClient(C.c1);
    expect(fClient).not.toBeNull();
    expect(sClient?.name).toBe(SUITE_CLIENT_NAME);
    expectParity(fClient, sClient, 'clientHierarchy.getClient');

    const fEntity = await fixtureClientHierarchy.getLegalEntity(
      (await fixtureClientHierarchy.listLegalEntities(CLIENTS[0].id))[0].id,
    );
    const sEntity = await supabaseClientHierarchy.getLegalEntity(E.e1);
    expect(fEntity).not.toBeNull();
    expect(sEntity?.id).toBe(E.e1);
    expectParity(fEntity, sEntity, 'clientHierarchy.getLegalEntity');
  });

  it('listLegalEntities / listRegistrations / listContacts / listClientRelationships', async () => {
    const fEntities = await fixtureClientHierarchy.listLegalEntities(CLIENTS[0].id);
    const sEntities = await supabaseClientHierarchy.listLegalEntities(C.c1);
    expect(fEntities.length).toBeGreaterThan(0);
    expect(sEntities.map((e) => e.id).sort()).toEqual([E.e1, E.e2].sort());
    expectParity(fEntities, sEntities, 'clientHierarchy.listLegalEntities');

    const fRegs = await fixtureClientHierarchy.listRegistrations(fEntities[0].id);
    const sRegs = await supabaseClientHierarchy.listRegistrations(E.e1);
    expect(fRegs.length).toBeGreaterThan(0);
    expect(sRegs).toHaveLength(1);
    expectParity(fRegs, sRegs, 'clientHierarchy.listRegistrations');

    const fContacts = await fixtureClientHierarchy.listContacts(CLIENTS[0].id);
    const sContacts = await supabaseClientHierarchy.listContacts(C.c1);
    // The demo fixtures carry no contacts or group edges (documented in
    // clientHierarchy/fixture.ts) — the fixture side is the truthful empty
    // collection here; array shapes compare when BOTH are non-empty by the
    // suite contract.
    expect(fContacts).toEqual([]);
    expect(sContacts).toHaveLength(1);
    expectParity(fContacts, sContacts, 'clientHierarchy.listContacts');

    const fRels = await fixtureClientHierarchy.listClientRelationships(fEntities[0].id);
    const sRels = await supabaseClientHierarchy.listClientRelationships(E.e1);
    expect(fRels).toEqual([]); // same documented demo-fixture gap
    expect(sRels).toHaveLength(1);
    expectParity(fRels, sRels, 'clientHierarchy.listClientRelationships');
  });

  it('listClientIdentities — the billing-role projection RPC (billing.a session on the supabase side)', async () => {
    const fIdentities = await fixtureClientHierarchy.listClientIdentities();
    // The RPC requires role='billing' (IMP-020 migration, RLS-A-04): the
    // supabase side is exercised under a billing.a session of the suite firm.
    await supabaseAs('USER_A_BILLING');
    const sIdentities = await supabaseClientHierarchy.listClientIdentities();
    await supabaseAs('USER_A_PARTNER');
    expect(fIdentities.length).toBeGreaterThan(0);
    expect(sIdentities).toHaveLength(1);
    expectParity(fIdentities, sIdentities, 'clientHierarchy.listClientIdentities');
  });
});

describe('TEST-MIG-02 — engagements parity', () => {
  it('listEngagements / getEngagement', async () => {
    const fList = await fixtureEngagements.listEngagements();
    const sList = await supabaseEngagements.listEngagements();
    expect(fList.length).toBeGreaterThan(0);
    expect(sList.map((e) => e.id)).toEqual([ENG]);
    expectParity(fList, sList, 'engagements.listEngagements');

    const fEng = await fixtureEngagements.getEngagement(fList[0].id);
    const sEng = await supabaseEngagements.getEngagement(ENG);
    expect(fEng).not.toBeNull();
    expect(sEng?.id).toBe(ENG);
    expectParity(fEng, sEng, 'engagements.getEngagement');
  });

  it('listEngagementLetterStatuses — the billing-role projection RPC (billing.a session on the supabase side)', async () => {
    const fStatuses = await fixtureEngagements.listEngagementLetterStatuses();
    await supabaseAs('USER_A_BILLING');
    const sStatuses = await supabaseEngagements.listEngagementLetterStatuses();
    await supabaseAs('USER_A_PARTNER');
    expect(fStatuses.length).toBeGreaterThan(0);
    expect(sStatuses).toHaveLength(1);
    expectParity(fStatuses, sStatuses, 'engagements.listEngagementLetterStatuses');
  });
});

describe('TEST-MIG-02 — client360 parity', () => {
  it('getClient360 / listActiveStaff', async () => {
    const fView = await fixtureClient360.getClient360(CLIENTS[0].id);
    const sView = await supabaseClient360.getClient360(C.c1);
    expect(fView).not.toBeNull();
    expect(sView?.client.id).toBe(C.c1);
    expectParity(fView, sView, 'client360.getClient360');

    const fStaff = await fixtureClient360.listActiveStaff();
    const sStaff = await supabaseClient360.listActiveStaff();
    expect(fStaff.length).toBeGreaterThan(0);
    expect(sStaff.length).toBeGreaterThan(0);
    expectParity(fStaff, sStaff, 'client360.listActiveStaff');
  });
});

describe('TEST-MIG-02 — complianceRules parity (the fixture mirror carries the SAME MIG-SEED-02 uuids)', () => {
  it('listComplianceTypes / getComplianceType — identical seed ids on both sides', async () => {
    const fTypes = await fixtureComplianceRules.listComplianceTypes();
    const sTypes = await supabaseComplianceRules.listComplianceTypes();
    expect(fTypes.length).toBeGreaterThanOrEqual(14);
    expect(sTypes.map((t) => t.id)).toContain(SYS_ITR);
    expectParity(fTypes, sTypes, 'complianceRules.listComplianceTypes');

    const fType = await fixtureComplianceRules.getComplianceType(SYS_ITR);
    const sType = await supabaseComplianceRules.getComplianceType(SYS_ITR);
    expect(fType?.id).toBe(SYS_ITR);
    expect(sType?.id).toBe(SYS_ITR);
    expectParity(fType, sType, 'complianceRules.getComplianceType');
  });

  it('listRuleVersions / getRuleVersion — identical seed ids on both sides', async () => {
    const fVersions = await fixtureComplianceRules.listRuleVersions();
    const sVersions = await supabaseComplianceRules.listRuleVersions();
    expect(fVersions.length).toBeGreaterThanOrEqual(14);
    expect(sVersions.map((v) => v.id)).toContain(SYS_ITR_VERSION);
    expectParity(fVersions, sVersions, 'complianceRules.listRuleVersions');

    const fVersion = await fixtureComplianceRules.getRuleVersion(SYS_ITR_VERSION);
    const sVersion = await supabaseComplianceRules.getRuleVersion(SYS_ITR_VERSION);
    expect(fVersion?.id).toBe(SYS_ITR_VERSION);
    expect(sVersion?.id).toBe(SYS_ITR_VERSION);
    // The shared seed truth (MIG-SEED-02 / TEST-MIG-15): draft + pending on
    // BOTH adapters — the demo never fakes statutory activation.
    expect(fVersion?.status).toBe('draft');
    expect(fVersion?.domainApprovalStatus).toBe('pending');
    expect(sVersion?.status).toBe('draft');
    expect(sVersion?.domainApprovalStatus).toBe('pending');
    expectParity(fVersion, sVersion, 'complianceRules.getRuleVersion');
  });
});

describe('TEST-MIG-02 — complianceInstances parity', () => {
  it('listComplianceProfiles / getComplianceProfile', async () => {
    const fProfiles = await fixtureComplianceInstances.listComplianceProfiles();
    const sProfiles = await supabaseComplianceInstances.listComplianceProfiles();
    expect(fProfiles.length).toBeGreaterThan(0);
    expect(sProfiles.map((p) => p.id)).toEqual([CCP]);
    expectParity(fProfiles, sProfiles, 'complianceInstances.listComplianceProfiles');

    const fProfile = await fixtureComplianceInstances.getComplianceProfile(fProfiles[0].id);
    const sProfile = await supabaseComplianceInstances.getComplianceProfile(CCP);
    expect(fProfile).not.toBeNull();
    expect(sProfile?.id).toBe(CCP);
    expectParity(fProfile, sProfile, 'complianceInstances.getComplianceProfile');
  });

  it('listComplianceInstances / getComplianceInstance', async () => {
    const fInstances = await fixtureComplianceInstances.listComplianceInstances();
    const sInstances = await supabaseComplianceInstances.listComplianceInstances();
    expect(fInstances.length).toBeGreaterThan(0);
    expect(sInstances.map((i) => i.id).sort()).toEqual([I.i1, I.i2].sort());
    expectParity(fInstances, sInstances, 'complianceInstances.listComplianceInstances');

    const fInstance = await fixtureComplianceInstances.getComplianceInstance(fInstances[0].id);
    const sInstance = await supabaseComplianceInstances.getComplianceInstance(I.i1);
    expect(fInstance).not.toBeNull();
    expect(sInstance?.id).toBe(I.i1);
    expectParity(fInstance, sInstance, 'complianceInstances.getComplianceInstance');
  });
});

describe('TEST-MIG-02 — tasks parity', () => {
  it('listTasks / getTaskDetail', async () => {
    const fTasks = await fixtureTasks.listTasks();
    const sTasks = await supabaseTasks.listTasks();
    expect(fTasks.length).toBeGreaterThan(0);
    expect(sTasks.map((t) => t.id).sort()).toEqual([T.t1, T.t2].sort());
    expectParity(fTasks, sTasks, 'tasks.listTasks');

    const fDetail = await fixtureTasks.getTaskDetail(fTasks[0].id);
    const sDetail = await supabaseTasks.getTaskDetail(T.t1);
    expect(fDetail).not.toBeNull();
    expect(sDetail?.task.id).toBe(T.t1);
    expectParity(fDetail, sDetail, 'tasks.getTaskDetail');
  });
});

describe('TEST-MIG-02 — review parity', () => {
  it('listReviewItems', async () => {
    const fItems = await fixtureReview.listReviewItems();
    const sItems = await supabaseReview.listReviewItems();
    expect(fItems.length).toBeGreaterThan(0);
    expect(sItems).toHaveLength(1);
    expectParity(fItems, sItems, 'review.listReviewItems');
  });

  it('subscribeReviewQueue is an arity-1 function on BOTH adapters (transport differs by design — NOT invoked)', () => {
    // Bounded choice (package instruction): contract shape parity only. The
    // supabase implementation opens the IMP-062 realtime broadcast + API-RT-07
    // polling fallback transport and is deliberately never invoked here.
    expect(typeof fixtureReview.subscribeReviewQueue).toBe('function');
    expect(typeof supabaseReview.subscribeReviewQueue).toBe('function');
    expect(fixtureReview.subscribeReviewQueue.length).toBe(1);
    expect(supabaseReview.subscribeReviewQueue.length).toBe(1);
  });
});

describe('TEST-MIG-02 — alerts parity', () => {
  it('listAlerts / listAlertRules', async () => {
    const fAlerts = await fixtureAlerts.listAlerts();
    const sAlerts = await supabaseAlerts.listAlerts();
    expect(fAlerts.length).toBeGreaterThan(0);
    expect(sAlerts).toHaveLength(2);
    expectParity(fAlerts, sAlerts, 'alerts.listAlerts');

    const fRules = await fixtureAlerts.listAlertRules();
    const sRules = await supabaseAlerts.listAlertRules();
    // Zero seeded alert_rules (D3 ruling, AUTO-OQ-04 OPEN) — the supabase
    // side is the truthful empty collection; shapes compare when both
    // non-empty by contract.
    expect(sRules).toEqual([]);
    expectParity(fRules, sRules, 'alerts.listAlertRules');
  });

  it('subscribeAlerts is an arity-1 function on BOTH adapters (transport differs by design — NOT invoked)', () => {
    // Same bounded choice as subscribeReviewQueue above.
    expect(typeof fixtureAlerts.subscribeAlerts).toBe('function');
    expect(typeof supabaseAlerts.subscribeAlerts).toBe('function');
    expect(fixtureAlerts.subscribeAlerts.length).toBe(1);
    expect(supabaseAlerts.subscribeAlerts.length).toBe(1);
  });
});

describe('TEST-MIG-02 — mywork parity', () => {
  it('getMyWork (senior.a session — the assignee of the suite tasks)', async () => {
    const fBuckets = await fixtureMyWork.getMyWork();
    await supabaseAs('USER_A_SENIOR');
    const sBuckets = await supabaseMyWork.getMyWork();
    await supabaseAs('USER_A_PARTNER');
    expectParity(fBuckets, sBuckets, 'mywork.getMyWork');
  });
});

describe('TEST-MIG-02 — dashboard parity', () => {
  it('getDashboardAggregates', async () => {
    const fAggregates = await fixtureDashboard.getDashboardAggregates();
    const sAggregates = await supabaseDashboard.getDashboardAggregates();
    // Non-vacuity on the supabase side: the suite fixture is visible.
    expect(sAggregates.taskCountsByState.in_progress).toBe(1);
    expectParity(fAggregates, sAggregates, 'dashboard.getDashboardAggregates');
  });
});

describe('TEST-MIG-02 — search parity', () => {
  it('searchStructured — ≥1 hit on each side', async () => {
    // Fixture anchor: the demo barrel's first client name prefix (≥2 chars,
    // IMP061-R4). Supabase anchor: the suite client name prefix.
    const fixtureQuery = CLIENTS[0].name.split(' ')[0];
    expect(fixtureQuery.length).toBeGreaterThanOrEqual(2);
    const fHits = await fixtureSearch.searchStructured(fixtureQuery);
    const sHits = await supabaseSearch.searchStructured('MIG070');
    expect(fHits.length).toBeGreaterThan(0);
    expect(sHits.length).toBeGreaterThan(0);
    expect(sHits.some((h) => h.id === C.c1)).toBe(true);
    expectParity(fHits, sHits, 'search.searchStructured');
  });
});

describe('TEST-MIG-02 — deadlines parity', () => {
  it('listDeadlineGroups / listDeadlineGroupInstances / listClientDependencies', async () => {
    const fGroups = await fixtureDeadlines.listDeadlineGroups();
    const sGroups = await supabaseDeadlines.listDeadlineGroups();
    expect(fGroups.length).toBeGreaterThan(0);
    // Two (compliance_type_id, due_date) groups from the suite fixture.
    expect(sGroups).toHaveLength(2);
    expectParity(fGroups, sGroups, 'deadlines.listDeadlineGroups');

    const fInstances = await fixtureDeadlines.listDeadlineGroupInstances(fGroups[0].groupId);
    const sInstances = await supabaseDeadlines.listDeadlineGroupInstances(sGroups[0].groupId);
    expect(fInstances.length).toBeGreaterThan(0);
    expect(sInstances.length).toBeGreaterThan(0);
    expectParity(fInstances, sInstances, 'deadlines.listDeadlineGroupInstances');

    const fDeps = await fixtureDeadlines.listClientDependencies();
    const sDeps = await supabaseDeadlines.listClientDependencies();
    expect(fDeps.length).toBeGreaterThan(0);
    // information_requested instance + the waiting task.
    expect(sDeps.map((d) => d.id).sort()).toEqual([I.i2, T.t2].sort());
    expectParity(fDeps, sDeps, 'deadlines.listClientDependencies');
  });
});
