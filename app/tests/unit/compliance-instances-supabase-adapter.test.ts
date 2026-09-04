/**
 * IMP-031 — Supabase adapter write-payload shape test (production path,
 * network mocked).
 *
 * The security review removed the four recurrence-provenance columns
 * (rule_version_id, generation_source, generated_at, calculated_due_date)
 * from the authenticated INSERT grant on compliance_instances — sending any
 * of them now fails 42501. This test pins the adapter to the granted write
 * surface: it mocks the browser client boundary (@/lib/supabaseClient),
 * captures the exact insert payload, and asserts no provenance (or other
 * server-controlled) keys are sent. generation_source defaults to 'manual'
 * server-side; IMP-050's generator (service_role) is the only
 * recurrence-provenance writer (AUTO-REC-07).
 *
 * The supabase adapter is imported DIRECTLY here (not via the
 * DATA_SOURCE-pinned selector) — a test-only reach into the implementation
 * module to verify the production write contract without a backend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setActiveFirm, clearActiveFirm } from '@/data/context';

// Captured payloads per table, populated by the mocked client below.
const captured: { table: string; insertPayload?: Record<string, unknown> }[] = [];

const INSTANCE_ROW = {
  id: '00000000-0000-4000-8000-0000000000aa',
  firm_id: 'firm-1',
  client_id: 'client-1',
  legal_entity_id: 'entity-1',
  compliance_type_id: 'type-1',
  registration_id: null,
  client_compliance_profile_id: null,
  engagement_id: null,
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  period_label: 'Aug 2026',
  period_meta: null,
  due_date: '2026-09-11',
  rule_version_id: null,
  generation_source: 'manual',
  generated_at: null,
  calculated_due_date: null,
  state: 'not_started',
  assignee_membership_id: null,
  reviewer_membership_id: null,
  partner_membership_id: null,
  priority: 'normal',
  risk_score: null,
  risk_factors: null,
  filed_at: null,
  closed_at: null,
  successor_instance_id: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: null,
};

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      const entry: { table: string; insertPayload?: Record<string, unknown> } = { table };
      captured.push(entry);
      return {
        insert: (payload: Record<string, unknown>) => {
          entry.insertPayload = payload;
          return {
            select: () => ({
              single: async () => ({ data: INSTANCE_ROW, error: null }),
            }),
          };
        },
      };
    },
  }),
}));

import { supabaseComplianceInstances } from '@/data/complianceInstances/supabase';

/** Columns no browser caller may write on compliance_instances
 *  (server-managed, command-stamped, or provenance — AUTO-REC-07). */
const FORBIDDEN_INSERT_KEYS = [
  'id',
  'client_id',
  'state',
  'filed_at',
  'closed_at',
  'rule_version_id',
  'generation_source',
  'generated_at',
  'calculated_due_date',
  'risk_score',
  'risk_factors',
  'successor_instance_id',
  'created_at',
  'updated_at',
];

describe('supabase adapter — instance create payload shape', () => {
  beforeEach(() => {
    captured.length = 0;
    setActiveFirm('firm-1');
  });

  afterEach(() => {
    clearActiveFirm();
  });

  it('sends only the granted columns — no provenance keys (AUTO-REC-07, 42501-safe)', async () => {
    const created = await supabaseComplianceInstances.createComplianceInstance({
      legalEntityId: 'entity-1',
      complianceTypeId: 'type-1',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      periodLabel: 'Aug 2026',
      dueDate: '2026-09-11',
      assigneeMembershipId: 'm-1',
    });
    expect(created.generationSource).toBe('manual'); // server default echoed back

    const insert = captured.find((c) => c.table === 'compliance_instances')?.insertPayload;
    expect(insert).toBeDefined();
    const keys = Object.keys(insert!);
    for (const forbidden of FORBIDDEN_INSERT_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
    // Exactly the granted insert surface, nothing more.
    expect(keys.sort()).toEqual(
      [
        'firm_id',
        'legal_entity_id',
        'compliance_type_id',
        'registration_id',
        'client_compliance_profile_id',
        'engagement_id',
        'period_start',
        'period_end',
        'period_label',
        'period_meta',
        'due_date',
        'assignee_membership_id',
        'reviewer_membership_id',
        'partner_membership_id',
        'priority',
      ].sort(),
    );
  });
});
