/**
 * IMP-030 — Fixture compliance-rules adapter parity test (demo track).
 *
 * Runs under the unit harness, which pins DATA_SOURCE=fixture
 * (tests/setup.ts), so complianceRulesService resolves to the fixture
 * implementation. Verifies the catalogue mirrors the MIG-SEED-02 reference
 * seeds (same UUIDs, same governance classifications, zero active
 * statutory rules) and that the fixture mirrors the production contract:
 * governance inheritance, derived approval state, draft-only content
 * edits, the statutory activation gate, and SCH-32 succession.
 */
import { describe, expect, it } from 'vitest';

import { complianceRulesService } from '@/data/complianceRules';
import { ApiError } from '@/data/errors';

const SYS_GSTR1 = '50000000-0000-4000-8000-000000000001';
const SYS_CERT = '50000000-0000-4000-8000-00000000000e';
const SYS_GSTR1_V1 = '50000000-0000-4000-8000-000000000101';

const apiError = (kind: string) =>
  expect.objectContaining({ kind }) as unknown as ApiError;

describe('fixture compliance-rules adapter', () => {
  it('resolves to fixture mode under the unit harness', () => {
    expect(complianceRulesService.mode).toBe('fixture');
  });

  it('mirrors the MIG-SEED-02 catalogue: 14 system defaults with deterministic seed UUIDs', async () => {
    const types = await complianceRulesService.listComplianceTypes();
    expect(types).toHaveLength(14);
    expect(types.every((t) => t.firmId === null)).toBe(true);
    const gstr1 = types.find((t) => t.typeKey === 'gstr1');
    expect(gstr1).toMatchObject({
      id: SYS_GSTR1,
      governanceClass: 'statutory',
      scopeKind: 'registration',
      registrationClass: 'GSTIN',
    });
    // Exactly one non-statutory reference type: the custom certificate lane.
    const nonStatutory = types.filter((t) => t.governanceClass === 'non_statutory');
    expect(nonStatutory.map((t) => t.typeKey)).toEqual(['certificate-custom']);
    // Payroll remains excluded from the R0 statutory catalogue.
    expect(types.some((t) => t.category === 'Payroll')).toBe(false);
  });

  it('seed versions stay draft: statutory pending, non-statutory not_required, ZERO active statutory', async () => {
    const versions = await complianceRulesService.listRuleVersions();
    expect(versions).toHaveLength(14);
    expect(versions.every((v) => v.status === 'draft')).toBe(true);
    const types = await complianceRulesService.listComplianceTypes();
    const byId = new Map(types.map((t) => [t.id, t]));
    for (const v of versions) {
      const parent = byId.get(v.complianceTypeId)!;
      expect(v.domainApprovalStatus).toBe(
        parent.governanceClass === 'statutory' ? 'pending' : 'not_required',
      );
    }
  });

  it('single-resource reads return null for unknown ids (no existence oracle, API-ERR-02)', async () => {
    expect(await complianceRulesService.getComplianceType(SYS_CERT)).toMatchObject({
      typeKey: 'certificate-custom',
      governanceClass: 'non_statutory',
    });
    expect(await complianceRulesService.getComplianceType('nope')).toBeNull();
    expect(await complianceRulesService.getRuleVersion(SYS_GSTR1_V1)).toMatchObject({
      status: 'draft',
      domainApprovalStatus: 'pending',
    });
    expect(await complianceRulesService.getRuleVersion('nope')).toBeNull();
  });

  it('governance inheritance: a firm override of statutory gstr1 cannot downgrade to non_statutory', async () => {
    await expect(
      complianceRulesService.createComplianceType({
        typeKey: 'gstr1',
        name: 'GSTR-1 override',
        category: 'GST',
        frequency: 'monthly',
        dueRule: { description: 'override' },
        workflowTemplate: { states: ['not_started', 'preparation', 'closed'] },
        governanceClass: 'non_statutory',
      }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('genuinely custom firm types may be non_statutory; governanceClass is fail-closed required', async () => {
    await expect(
      complianceRulesService.createComplianceType({
        typeKey: 'unit-custom-cert',
        name: 'Unit Custom Cert',
        category: 'Certificates',
        frequency: 'custom',
        dueRule: { description: 'custom' },
        workflowTemplate: { states: ['not_started', 'preparation', 'closed'] },
      } as never),
    ).rejects.toEqual(apiError('validation'));

    const created = await complianceRulesService.createComplianceType({
      typeKey: 'unit-custom-cert',
      name: 'Unit Custom Cert',
      category: 'Certificates',
      frequency: 'custom',
      dueRule: { description: 'custom' },
      workflowTemplate: { states: ['not_started', 'preparation', 'closed'] },
      governanceClass: 'non_statutory',
    });
    expect(created.firmId).toBe('demo-fixture-firm');
    expect(created.governanceClass).toBe('non_statutory');

    await expect(
      complianceRulesService.createComplianceType({
        typeKey: 'unit-custom-cert',
        name: 'dup',
        category: 'Certificates',
        frequency: 'custom',
        dueRule: {},
        workflowTemplate: { states: ['not_started'] },
        governanceClass: 'non_statutory',
      }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('system-default types are read-only in fixture mode too (TEN-08)', async () => {
    await expect(
      complianceRulesService.updateComplianceType(SYS_GSTR1, { name: 'hijacked' }),
    ).rejects.toEqual(apiError('unauthorized'));
  });

  it('rule versions derive approval state from the trusted parent type — never caller input', async () => {
    const firmGst = await complianceRulesService.createComplianceType({
      typeKey: 'gstr1',
      name: 'GSTR-1 (firm)',
      category: 'GST',
      frequency: 'monthly',
      dueRule: { description: 'firm gstr1' },
      workflowTemplate: { states: ['not_started', 'preparation', 'closed'] },
      governanceClass: 'statutory', // inherited; matches the system row
      scopeKind: 'registration',
      registrationClass: 'GSTIN',
    });
    const statutoryDraft = await complianceRulesService.createRuleVersion({
      complianceTypeId: firmGst.id,
      version: 1,
      effectiveFrom: '2026-04-01',
      frequency: 'monthly',
      dueRule: { description: 'v1' },
    });
    expect(statutoryDraft.status).toBe('draft');
    expect(statutoryDraft.domainApprovalStatus).toBe('pending');
    expect(statutoryDraft.firmId).toBe('demo-fixture-firm'); // inherited from parent

    await expect(
      complianceRulesService.createRuleVersion({
        complianceTypeId: firmGst.id,
        version: 1,
        effectiveFrom: '2026-05-01',
        frequency: 'monthly',
        dueRule: {},
      }),
    ).rejects.toEqual(apiError('conflict'));
  });

  it('activation gate + succession mirror the Layer-B command', async () => {
    const firmType = await complianceRulesService.createComplianceType({
      typeKey: 'unit-succession',
      name: 'Succession Lane',
      category: 'Certificates',
      frequency: 'custom',
      dueRule: { description: 'custom' },
      workflowTemplate: { states: ['not_started', 'preparation', 'closed'] },
      governanceClass: 'non_statutory',
    });
    const v1 = await complianceRulesService.createRuleVersion({
      complianceTypeId: firmType.id,
      version: 1,
      effectiveFrom: '2026-04-01',
      frequency: 'custom',
      dueRule: { description: 'v1' },
    });
    const v2 = await complianceRulesService.createRuleVersion({
      complianceTypeId: firmType.id,
      version: 2,
      effectiveFrom: '2026-10-01',
      frequency: 'annual',
      dueRule: { description: 'v2' },
    });

    // System-default activation is the deferred operator path.
    await expect(complianceRulesService.activateRuleVersion(SYS_GSTR1_V1)).rejects.toEqual(
      apiError('unauthorized'),
    );
    // Statutory firm draft with pending approval fails closed.
    const firmGst3b = await complianceRulesService.createComplianceType({
      typeKey: 'gstr3b',
      name: 'GSTR-3B (firm)',
      category: 'GST',
      frequency: 'monthly',
      dueRule: { description: 'firm gstr3b' },
      workflowTemplate: { states: ['not_started', 'preparation', 'closed'] },
      governanceClass: 'statutory', // inherited from the system row
      scopeKind: 'registration',
      registrationClass: 'GSTIN',
    });
    const statutoryDraft = await complianceRulesService.createRuleVersion({
      complianceTypeId: firmGst3b.id,
      version: 1,
      effectiveFrom: '2026-04-01',
      frequency: 'monthly',
      dueRule: { description: 'v1' },
    });
    expect(statutoryDraft.domainApprovalStatus).toBe('pending');
    await expect(complianceRulesService.activateRuleVersion(statutoryDraft.id)).rejects.toEqual(
      apiError('conflict'),
    );

    // Non-statutory firm draft activates; second activation closes the
    // predecessor's WINDOW, never its status.
    const first = await complianceRulesService.activateRuleVersion(v1.id);
    expect(first.version.status).toBe('active');
    expect(first.predecessor).toBeNull();

    const second = await complianceRulesService.activateRuleVersion(v2.id);
    expect(second.version.status).toBe('active');
    expect(second.predecessor).toMatchObject({ id: v1.id, status: 'active', effectiveTo: '2026-10-01' });

    // Class-A freeze: rule content is immutable once active.
    await expect(
      complianceRulesService.updateRuleVersionDraft(v1.id, { frequency: 'monthly' }),
    ).rejects.toEqual(apiError('conflict'));

    // Non-draft versions cannot re-activate.
    await expect(complianceRulesService.activateRuleVersion(v1.id)).rejects.toEqual(
      apiError('conflict'),
    );
  });

  it('fixture serves NO active statutory content (production gate parity)', async () => {
    const versions = await complianceRulesService.listRuleVersions({ status: 'active' });
    const types = await complianceRulesService.listComplianceTypes();
    const byId = new Map(types.map((t) => [t.id, t]));
    for (const v of versions) {
      expect(byId.get(v.complianceTypeId)!.governanceClass).toBe('non_statutory');
    }
  });
});
