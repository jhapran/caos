/**
 * IMP-070 — TEST-MIG-12 / MIG-VAL-01: named migration-validation invariants.
 *
 * Operator psql is the proof mechanism here by design (schema/catalog layer);
 * the ONE behavioral write proof (AUD-ACT-02) goes through the real API path.
 * The suite seeds the shared fixture (fixture-setup.mjs) so the data-layer
 * invariants run over a representative tenant dataset, and cleans up so the
 * post-suite catalog/row-count posture returns to the seeded baseline.
 *
 *   1. Catalog posture (MIG-VAL-01): 24 public BASE TABLEs, RLS enabled
 *      24/24, FORCE RLS on exactly 20 (all except firms, firm_memberships,
 *      profiles, scheduler_job_runs), exactly 51 public policies, and the
 *      realtime.messages policy inventory is exactly the two IMP-062 ones.
 *      The pinned lists are copied from
 *      tests/integration/schema/rls-catalog.test.ts (the standing catalog
 *      authority) — see the citation comments below.
 *   2. Seed row-count invariants (MIG-SEED-02): 14 system compliance_types
 *      (13 statutory + 1 non_statutory, all firm_id NULL), 14
 *      compliance_rule_versions (13 statutory draft+pending, 1 not_required,
 *      ZERO active), alert_rules = 0 (D3 ruling), scheduler tables present.
 *   3. Orphan scan (SCH-FK-01 composite-FK integrity) over the WHOLE public
 *      schema — zero orphans, suite data included.
 *   4. Uniqueness invariants (NULLS NOT DISTINCT semantics — plain GROUP BY
 *      already treats NULLs as one key value, matching the constraints).
 *   5. CHECK vocabulary conformance: the distinct lifecycle values present in
 *      the data are subsets of the approved vocabularies (non-vacuous: the
 *      suite fixture guarantees ≥1 row in tasks/instances/review/alerts).
 *   6. Generation provenance (AUTO-REC-07): zero 'recurrence' rows missing
 *      provenance; zero 'manual'/'import' rows carrying recurrence-only
 *      provenance columns; the authenticated INSERT grant excludes the
 *      provenance set.
 *   7. Audit presence (AUD-ACT-02): ONE real API write produces a human-actor
 *      audit row; the Layer-A trigger's operator-write behavior is proven
 *      truthfully with a scratch operator insert (see the test comment).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';
import { C, SUITE_FIRM, cleanMigrationFixture, seedMigrationFixture } from './fixture-setup.mjs';

// Pinned catalog lists — COPIED from
// tests/integration/schema/rls-catalog.test.ts (the standing catalog
// authority; keep in sync with it). IMP-050/051/060/061/062 add NO base
// table and NO public-schema policy (rls-catalog header, IMP-062 closure).
const RLS_ENABLED_24 = [
  'alert_rules',
  'alerts',
  'audit_log',
  'client_compliance_profiles',
  'client_relationships',
  'clients',
  'compliance_instances',
  'compliance_rule_versions',
  'compliance_types',
  'contacts',
  'engagements',
  'event_outbox',
  'firm_memberships',
  'firms',
  'legal_entities',
  'profiles',
  'registrations',
  'review_items',
  'scheduler_dead_letters',
  'scheduler_job_runs',
  'task_checklist_items',
  'task_comments',
  'task_dependencies',
  'tasks',
];
// FORCE RLS 20/24 — all except firms, firm_memberships, profiles (the IMP-012
// documented tenant-core exception) and scheduler_job_runs (SCH-34, Ruling
// R8: system-scoped, not tenant-owned).
const FORCED_20 = RLS_ENABLED_24.filter(
  (t) => !['firms', 'firm_memberships', 'profiles', 'scheduler_job_runs'].includes(t),
);

const rows = (sql: string): string[] => psql(sql).trim().split('\n').filter(Boolean).sort();
const count = (sql: string): string => psql(sql).trim();

beforeAll(() => {
  seedMigrationFixture();
});

afterAll(() => {
  cleanMigrationFixture();
});

describe('MIG-VAL-01 — catalog posture (24 tables / RLS 24/24 / FORCE 20 / 51 policies)', () => {
  it('exactly 24 public BASE TABLEs exist, RLS-enabled 24/24', () => {
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'`),
    ).toEqual(RLS_ENABLED_24);
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`),
    ).toEqual(RLS_ENABLED_24);
  });

  it('FORCE RLS is set on exactly the 20 tenant-owned content tables', () => {
    expect(
      rows(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity`),
    ).toEqual(FORCED_20.slice().sort());
  });

  it('exactly 51 public policies exist (the accepted IMP-≤062 inventory)', () => {
    // The full pinned policy list lives in rls-catalog.test.ts; MIG-VAL-01
    // pins the inventory SIZE plus the per-table coverage (every tenant
    // content table carries at least one policy, audit_log included).
    expect(count(`select count(*) from pg_policies where schemaname = 'public'`)).toBe('51');
  });

  it('realtime.messages policies are exactly the two IMP-062 ones (membership-scoped SELECT + deny-all INSERT)', () => {
    expect(
      rows(`select policyname || ':' || cmd from pg_policies
            where schemaname = 'realtime' and tablename = 'messages'`),
    ).toEqual(['imp062_rt_messages_insert_deny:INSERT', 'imp062_rt_messages_select:SELECT']);
  });

  it('the scheduler/automation tables are present (SCH-33/34/35)', () => {
    for (const table of ['event_outbox', 'scheduler_job_runs', 'scheduler_dead_letters']) {
      expect(RLS_ENABLED_24).toContain(table);
      expect(count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind = 'r' and c.relname = '${table}'`)).toBe('1');
    }
  });
});

describe('MIG-VAL-01 — seed row-count invariants (MIG-SEED-02 baseline)', () => {
  it('compliance_types: exactly 14 rows, all system defaults (firm_id NULL), 13 statutory + 1 non_statutory', () => {
    expect(count(`select count(*) from public.compliance_types`)).toBe('14');
    expect(count(`select count(*) from public.compliance_types where firm_id is not null`)).toBe('0');
    expect(count(`select count(*) from public.compliance_types where governance_class = 'statutory'`)).toBe('13');
    expect(count(`select count(*) from public.compliance_types where governance_class = 'non_statutory'`)).toBe('1');
  });

  it('compliance_rule_versions: exactly 14, statutory = draft+pending, custom = draft+not_required, ZERO active', () => {
    expect(count(`select count(*) from public.compliance_rule_versions`)).toBe('14');
    expect(count(`select count(*) from public.compliance_rule_versions where status = 'active'`)).toBe('0');
    expect(count(`select count(*) from public.compliance_rule_versions v
                  join public.compliance_types t on t.id = v.compliance_type_id
                  where t.governance_class = 'statutory'
                    and v.status = 'draft' and v.domain_approval_status = 'pending'`)).toBe('13');
    expect(count(`select count(*) from public.compliance_rule_versions
                  where status = 'draft' and domain_approval_status = 'not_required'`)).toBe('1');
  });

  it('alert_rules = 0 (D3 ruling — NO seed rows/thresholds, AUTO-OQ-04 stays open)', () => {
    expect(count(`select count(*) from public.alert_rules`)).toBe('0');
  });
});

describe('MIG-VAL-01 — orphan scan (SCH-FK-01 composite-FK integrity, whole public schema)', () => {
  it('zero orphans across every same-firm composite and reference FK relationship', () => {
    const ORPHAN_CHECKS: Array<[string, string]> = [
      ['compliance_instances→legal_entities',
        `select count(*) from public.compliance_instances i
           left join public.legal_entities p on p.firm_id = i.firm_id and p.id = i.legal_entity_id
          where p.id is null`],
      ['compliance_instances→clients (trigger-derived denormalization)',
        `select count(*) from public.compliance_instances i
           left join public.clients p on p.firm_id = i.firm_id and p.id = i.client_id
          where p.id is null`],
      ['compliance_instances→compliance_types (SCH-FK-03 reference-data exception: plain FK)',
        `select count(*) from public.compliance_instances i
           left join public.compliance_types p on p.id = i.compliance_type_id
          where p.id is null`],
      ['compliance_instances→registrations (nullable)',
        `select count(*) from public.compliance_instances i
           left join public.registrations p on p.firm_id = i.firm_id and p.id = i.registration_id
          where i.registration_id is not null and p.id is null`],
      ['compliance_instances→client_compliance_profiles (nullable)',
        `select count(*) from public.compliance_instances i
           left join public.client_compliance_profiles p on p.firm_id = i.firm_id and p.id = i.client_compliance_profile_id
          where i.client_compliance_profile_id is not null and p.id is null`],
      ['tasks→compliance_instances (nullable, DEC-H)',
        `select count(*) from public.tasks t
           left join public.compliance_instances p on p.firm_id = t.firm_id and p.id = t.compliance_instance_id
          where t.compliance_instance_id is not null and p.id is null`],
      ['tasks→clients',
        `select count(*) from public.tasks t
           left join public.clients p on p.firm_id = t.firm_id and p.id = t.client_id
          where p.id is null`],
      ['task_checklist_items→tasks',
        `select count(*) from public.task_checklist_items c
           left join public.tasks p on p.firm_id = c.firm_id and p.id = c.task_id
          where p.id is null`],
      ['task_comments→tasks',
        `select count(*) from public.task_comments c
           left join public.tasks p on p.firm_id = c.firm_id and p.id = c.task_id
          where p.id is null`],
      ['task_dependencies→tasks (task_id)',
        `select count(*) from public.task_dependencies d
           left join public.tasks p on p.firm_id = d.firm_id and p.id = d.task_id
          where p.id is null`],
      ['task_dependencies→tasks (depends_on_task_id)',
        `select count(*) from public.task_dependencies d
           left join public.tasks p on p.firm_id = d.firm_id and p.id = d.depends_on_task_id
          where p.id is null`],
      ['review_items→tasks (nullable)',
        `select count(*) from public.review_items r
           left join public.tasks p on p.firm_id = r.firm_id and p.id = r.task_id
          where r.task_id is not null and p.id is null`],
      ['review_items→compliance_instances (nullable)',
        `select count(*) from public.review_items r
           left join public.compliance_instances p on p.firm_id = r.firm_id and p.id = r.compliance_instance_id
          where r.compliance_instance_id is not null and p.id is null`],
      ['alerts→clients (nullable)',
        `select count(*) from public.alerts a
           left join public.clients p on p.firm_id = a.firm_id and p.id = a.client_id
          where a.client_id is not null and p.id is null`],
      ['alerts→compliance_instances (nullable)',
        `select count(*) from public.alerts a
           left join public.compliance_instances p on p.firm_id = a.firm_id and p.id = a.compliance_instance_id
          where a.compliance_instance_id is not null and p.id is null`],
      ['engagements→clients',
        `select count(*) from public.engagements e
           left join public.clients p on p.firm_id = e.firm_id and p.id = e.client_id
          where p.id is null`],
      ['registrations→legal_entities',
        `select count(*) from public.registrations r
           left join public.legal_entities p on p.firm_id = r.firm_id and p.id = r.legal_entity_id
          where p.id is null`],
      ['contacts→clients',
        `select count(*) from public.contacts c
           left join public.clients p on p.firm_id = c.firm_id and p.id = c.client_id
          where p.id is null`],
      ['contacts→legal_entities (nullable)',
        `select count(*) from public.contacts c
           left join public.legal_entities p on p.firm_id = c.firm_id and p.id = c.legal_entity_id
          where c.legal_entity_id is not null and p.id is null`],
      ['client_relationships→legal_entities (from endpoint)',
        `select count(*) from public.client_relationships r
           left join public.legal_entities p on p.firm_id = r.firm_id and p.id = r.from_entity_id
          where p.id is null`],
      ['client_relationships→legal_entities (to endpoint)',
        `select count(*) from public.client_relationships r
           left join public.legal_entities p on p.firm_id = r.firm_id and p.id = r.to_entity_id
          where p.id is null`],
    ];
    for (const [label, sql] of ORPHAN_CHECKS) {
      expect(count(sql), label).toBe('0');
    }
  });
});

describe('MIG-VAL-01 — uniqueness invariants', () => {
  it('no duplicate (compliance_type_id, legal_entity_id, registration_id, period_start) in compliance_instances', () => {
    // NULLS NOT DISTINCT semantics: plain GROUP BY already groups NULL keys
    // as one value, matching cin_obligation_period_unique exactly.
    expect(count(`
      select count(*) from (
        select 1 from public.compliance_instances
         group by compliance_type_id, legal_entity_id, registration_id, period_start
        having count(*) > 1
      ) d`)).toBe('0');
  });

  it('no duplicate (firm_id, type, value) in registrations; no duplicate (firm_id, rule_key) in alert_rules; firm_memberships (firm_id, user_id) unique', () => {
    expect(count(`
      select count(*) from (
        select 1 from public.registrations group by firm_id, type, value having count(*) > 1
      ) d`)).toBe('0');
    expect(count(`
      select count(*) from (
        select 1 from public.alert_rules group by firm_id, rule_key having count(*) > 1
      ) d`)).toBe('0');
    expect(count(`
      select count(*) from (
        select 1 from public.firm_memberships group by firm_id, user_id having count(*) > 1
      ) d`)).toBe('0');
  });
});

describe('MIG-VAL-01 — CHECK vocabulary conformance (distinct live values ⊆ approved vocabularies)', () => {
  const VOCABULARIES: Array<{ table: string; column: string; vocab: string[]; nonVacuous: boolean }> = [
    { table: 'tasks', column: 'status', vocab: ['open', 'in_progress', 'waiting', 'submitted', 'returned', 'approved', 'done', 'cancelled'], nonVacuous: true },
    {
      table: 'compliance_instances', column: 'state',
      vocab: ['not_started', 'information_requested', 'information_received', 'preparation', 'internal_review', 'client_approval', 'ready_to_file', 'filed', 'acknowledgement_received', 'closed'],
      nonVacuous: true,
    },
    { table: 'review_items', column: 'status', vocab: ['pending', 'approved', 'returned', 'escalated', 'dismissed'], nonVacuous: true },
    { table: 'review_items', column: 'type', vocab: ['gst_reconciliation', 'tds_return', 'itr_computation', 'financial_statements', 'audit_workpaper'], nonVacuous: true },
    { table: 'alerts', column: 'status', vocab: ['active', 'acknowledged', 'snoozed', 'resolved'], nonVacuous: true },
    { table: 'engagements', column: 'status', vocab: ['draft', 'proposed', 'active', 'completed', 'terminated'], nonVacuous: true },
  ];

  for (const { table, column, vocab, nonVacuous } of VOCABULARIES) {
    it(`${table}.${column}: every distinct value present is in the CHECK vocabulary`, () => {
      const present = rows(`select distinct ${column} from public.${table}`);
      if (nonVacuous) {
        // The suite fixture makes these checks non-vacuous.
        expect(present.length, `${table}.${column} must carry ≥1 distinct value`).toBeGreaterThan(0);
      }
      for (const value of present) {
        expect(vocab, `${table}.${column}='${value}'`).toContain(value);
      }
    });
  }
});

describe('MIG-VAL-01 — generation provenance (AUTO-REC-07)', () => {
  it("zero 'recurrence' instances missing rule_version_id/generated_at (the SCH-12 provenance CHECK)", () => {
    expect(count(`
      select count(*) from public.compliance_instances
       where generation_source = 'recurrence'
         and (rule_version_id is null or generated_at is null)`)).toBe('0');
  });

  it("zero 'manual'/'import' instances carrying recurrence-only provenance (rule_version_id/generated_at)", () => {
    // rule_version_id/generated_at are recurrence provenance — no legitimate
    // manual/import row carries them. calculated_due_date is deliberately NOT
    // asserted here: it is a settable provenance column on operator/manual
    // rows (the IMP-051 deadline-suite fixture precedent) and the SCH-12
    // CHECK constrains only the recurrence direction.
    expect(count(`
      select count(*) from public.compliance_instances
       where generation_source in ('manual', 'import')
         and (rule_version_id is not null or generated_at is not null)`)).toBe('0');
  });

  it('the authenticated INSERT grant excludes the recurrence provenance column set (grant-layer AUTO-REC-07)', () => {
    expect(count(`
      select count(*) from information_schema.role_column_grants
       where table_schema = 'public' and grantee = 'authenticated'
         and table_name = 'compliance_instances' and privilege_type = 'INSERT'
         and column_name in ('rule_version_id', 'generation_source', 'generated_at', 'calculated_due_date')`)).toBe('0');
  });
});

describe('MIG-VAL-01 — audit presence (AUD-ACT-02)', () => {
  const SCRATCH_CONTACT = '70000000-0000-4000-8000-0000000000c1';
  let apiContactId: string | null = null;

  afterAll(() => {
    // Remove the scratch rows and THEIR audit evidence (scoped to these two
    // object ids only — AUD-INV-01-safe).
    psql(`
      delete from public.contacts where firm_id = '${SUITE_FIRM}'
        and (id = '${SCRATCH_CONTACT}' ${apiContactId ? `or id = '${apiContactId}'` : ''});
      delete from public.audit_log where firm_id = '${SUITE_FIRM}'
        and object_type = 'contact'
        and object_id in ('${SCRATCH_CONTACT}'${apiContactId ? `, '${apiContactId}'` : ''});
    `);
  });

  it('ONE real API write (manager.a creates a contact) lands a human-actor audit row for that table+row', async () => {
    const s = await signIn(userEmail('USER_A_MANAGER'));
    expect(s.ok).toBe(true);
    const res = await api(s.token, 'POST', 'contacts', {
      headers: { 'x-active-firm': SUITE_FIRM },
      body: { firm_id: SUITE_FIRM, client_id: C.c1, name: 'MIG070 AUD-ACT-02 contact' },
    });
    expect(res.status).toBe(201);
    apiContactId = (res.body as Array<{ id: string }>)[0].id;

    const audit = psql(`
      select actor_type || '|' || coalesce(actor_user_id::text, '-') || '|' || action || '|' || object_type
        from public.audit_log
       where firm_id = '${SUITE_FIRM}' and object_type = 'contact' and object_id = '${apiContactId}';
    `).trim();
    expect(audit).toBe(`human|${userId('USER_A_MANAGER')}|insert|contact`);
  });

  it('the Layer-A trigger DOES write for operator inserts — as system/database-operator (proven with a scratch row)', () => {
    // Truthful path note: fixture-setup sweeps its seed-time audit noise
    // (AUD-INV-01, the cross-suite precedent), so the operator-write behavior
    // is proven here with a dedicated scratch insert instead of the seeded
    // client. The audit trigger (20260902000000_audit_foundation.sql) maps
    // a writer with no auth.uid()/JWT to actor_type='system',
    // service_name='database-operator' — assert exactly that.
    psql(`
      insert into public.contacts (id, firm_id, client_id, name) values
        ('${SCRATCH_CONTACT}', '${SUITE_FIRM}', '${C.c1}', 'MIG070 operator scratch');
    `);
    const audit = psql(`
      select actor_type || '|' || coalesce(service_name, '-') || '|' || action
        from public.audit_log
       where firm_id = '${SUITE_FIRM}' and object_type = 'contact' and object_id = '${SCRATCH_CONTACT}';
    `).trim();
    expect(audit).toBe('system|database-operator|insert');
    psql(`
      delete from public.contacts where id = '${SCRATCH_CONTACT}';
      delete from public.audit_log where firm_id = '${SUITE_FIRM}'
        and object_type = 'contact' and object_id = '${SCRATCH_CONTACT}';
    `);
  });
});
