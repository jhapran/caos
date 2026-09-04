-- supabase/seed.sql
--
-- Seed ownership:
--   * SQL seed (this file): R0 reference/system data per
--     docs/spec/10-migration-seed.md (MIG-SEED-02 below).
--   * Deterministic local Auth harness users:
--     scripts/harness/seed-harness.mjs (npm run db:seed:harness,
--     npm run db:reset:harness) using tests/harness/registry.json.
--   * Harness verification: npm run db:verify:harness.
--
-- All seed content is synthetic and environment-labelled for local
-- development only — never production seed data (MIG-SEED-06).

-- ---------------------------------------------------------------------------
-- IMP-030 / MIG-SEED-02 — compliance-type reference data (SCH-10 + SCH-32)
--
-- The statutory catalogue as compliance_types SYSTEM DEFAULTS (NULL firm_id)
-- plus their initial compliance_rule_versions, mapped from the demo fixture
-- catalogue (COMPLIANCE_MASTER, spec 10 fixture mapping) with scope_kind /
-- registration_class per the DM-27 Registration Scope Matrix
-- (registration_class uses the SCH-07 registrations.type vocabulary).
--
-- GOVERNANCE (R0 closure 2026-09-03):
--   * GST, TDS, Income Tax/ITR, ROC/MCA, Professional Tax, PF, ESI, Audit
--     are governance_class='statutory'; Certificates/custom recurring is
--     'non_statutory'; Payroll is EXCLUDED from the statutory catalogue
--     (SCH-OQ-06 — the fixture's combined "PF/ESI" demo type maps to the
--     separate PF and ESI families here).
--   * These rows define CAPABILITY, not activated statutory calendars.
--     Every statutory initial version is status='draft' +
--     domain_approval_status='pending'; production statutory activation is
--     a separate gated step requiring external practicing-CA/domain
--     sign-off (DM-OQ-01, OPS-ACT-01, OPS-OQ-04 OPEN). The single
--     non-statutory custom type carries 'not_required'.
--   * due_rule content is a STRUCTURED MAPPING of fixture demo text
--     (spec 10: "dueRule text -> structured due_rule jsonb"), explicitly
--     marked statutorily unvalidated — no statutory claim is made or
--     implied by these rows.
--
-- Deterministic fixed UUIDs (MIG-SEED-06) and ON CONFLICT DO NOTHING keep
-- reseeding idempotent. Layer-A audit records these as system-actor writes
-- with the NULL platform marker (AUD-CRV-03, AUD-EVT-03).
-- ---------------------------------------------------------------------------

insert into public.compliance_types (
  id, firm_id, type_key, name, category, authority,
  frequency, due_rule, applicability, required_documents, checklist_template,
  workflow_template,
  client_approval_required, filing_confirmation_required,
  acknowledgement_required, four_eyes_required,
  scope_kind, registration_class, governance_class, status
) values
  -- GST family (registration-scoped, GSTIN)
  ('50000000-0000-4000-8000-000000000001', null, 'gstr1', 'GSTR-1 (Outward Supplies)', 'GST', 'GSTN',
   'monthly', '{"description":"11th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'GSTIN', 'statutory', 'active'),
  ('50000000-0000-4000-8000-000000000002', null, 'gstr3b', 'GSTR-3B (Summary Return)', 'GST', 'GSTN',
   'monthly', '{"description":"20th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'GSTIN', 'statutory', 'active'),
  -- TDS family (registration-scoped, TAN; statutory PAN-based exception is a
  -- DM-27 instance-scope concern, not a type attribute)
  ('50000000-0000-4000-8000-000000000003', null, 'tds24q', 'TDS Return 24Q (Salaries)', 'TDS', 'Income Tax Department',
   'quarterly', '{"description":"31st of month following quarter","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'TAN', 'statutory', 'active'),
  ('50000000-0000-4000-8000-000000000004', null, 'tds26q', 'TDS Return 26Q (Non-salary)', 'TDS', 'Income Tax Department',
   'quarterly', '{"description":"31st of month following quarter","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'TAN', 'statutory', 'active'),
  -- Income Tax family (entity-scoped)
  ('50000000-0000-4000-8000-000000000005', null, 'itr', 'Income Tax Return', 'Income Tax', 'Income Tax Department',
   'annual', '{"description":"31 Oct (audit) / 31 Jul (non-audit)","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'entity', null, 'statutory', 'active'),
  ('50000000-0000-4000-8000-000000000006', null, 'advance-tax', 'Advance Tax Instalment', 'Income Tax', 'Income Tax Department',
   'quarterly', '{"description":"15 Jun / 15 Sep / 15 Dec / 15 Mar","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'entity', null, 'statutory', 'active'),
  -- Audit family (entity-scoped)
  ('50000000-0000-4000-8000-000000000007', null, 'tax-audit', 'Tax Audit (44AB)', 'Audit', 'Income Tax Department',
   'annual', '{"description":"30 Sep following FY","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'entity', null, 'statutory', 'active'),
  ('50000000-0000-4000-8000-000000000008', null, 'stat-audit', 'Statutory Audit', 'Audit', 'MCA / applicable statute',
   'annual', '{"description":"Within 6 months of FY end (AGM)","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'entity', null, 'statutory', 'active'),
  -- ROC / MCA family (entity-scoped)
  ('50000000-0000-4000-8000-000000000009', null, 'mca-aoc4', 'MCA AOC-4 (Financial Statements)', 'ROC/MCA', 'MCA',
   'annual', '{"description":"30 days from AGM","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'entity', null, 'statutory', 'active'),
  ('50000000-0000-4000-8000-00000000000a', null, 'mca-mgt7', 'MCA MGT-7 (Annual Return)', 'ROC/MCA', 'MCA',
   'annual', '{"description":"60 days from AGM","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'entity', null, 'statutory', 'active'),
  -- Professional Tax (registration-scoped, PT; no single nationwide rule —
  -- DM-27 — hence frequency 'custom')
  ('50000000-0000-4000-8000-00000000000b', null, 'pt', 'Professional Tax', 'Professional Tax', 'State commercial tax authority',
   'custom', '{"description":"State/jurisdiction-specific schedule (no single nationwide PT rule modelled, DM-27)","provenance":"architecture-matrix","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'PT', 'statutory', 'active'),
  -- PF family (registration-scoped, PF establishment code in SCH-07 terms)
  ('50000000-0000-4000-8000-00000000000c', null, 'pf', 'PF Return', 'PF', 'EPFO',
   'monthly', '{"description":"15th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'PF', 'statutory', 'active'),
  -- ESI family (registration-scoped, ESI employer code in SCH-07 terms)
  ('50000000-0000-4000-8000-00000000000d', null, 'esi', 'ESI Return', 'ESI', 'ESIC',
   'monthly', '{"description":"15th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   true, true, true, true,
   'registration', 'ESI', 'statutory', 'active'),
  -- Certificates / custom recurring (configurable, NON-statutory)
  ('50000000-0000-4000-8000-00000000000e', null, 'certificate-custom', 'Certificates / Custom Recurring', 'Certificates', null,
   'custom', '{"description":"Per configured schedule","provenance":"architecture-matrix","statutoryValidation":"not-applicable"}', null, null, null,
   '{"states":["not_started","information_requested","information_received","preparation","internal_review","client_approval","ready_to_file","filed","acknowledgement_received","closed"]}',
   false, true, true, true,
   'configurable', null, 'non_statutory', 'active')
on conflict (type_key, firm_id) do nothing;

-- Initial rule versions (SCH-32): every statutory catalogue type gets its
-- draft v1 (domain_approval_status='pending'); the non-statutory custom type
-- carries 'not_required'. NONE are active — zero production statutory
-- activation (DM-OQ-01). effective_from is a deterministic placeholder
-- (FY 2026-27 start); a draft window governs nothing until activation.
insert into public.compliance_rule_versions (
  id, firm_id, compliance_type_id, version,
  effective_from, effective_to, frequency, due_rule,
  status, domain_approval_status, created_by
) values
  ('50000000-0000-4000-8000-000000000101', null, '50000000-0000-4000-8000-000000000001', 1, '2026-04-01', null,
   'monthly', '{"description":"11th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000102', null, '50000000-0000-4000-8000-000000000002', 1, '2026-04-01', null,
   'monthly', '{"description":"20th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000103', null, '50000000-0000-4000-8000-000000000003', 1, '2026-04-01', null,
   'quarterly', '{"description":"31st of month following quarter","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000104', null, '50000000-0000-4000-8000-000000000004', 1, '2026-04-01', null,
   'quarterly', '{"description":"31st of month following quarter","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000105', null, '50000000-0000-4000-8000-000000000005', 1, '2026-04-01', null,
   'annual', '{"description":"31 Oct (audit) / 31 Jul (non-audit)","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000106', null, '50000000-0000-4000-8000-000000000006', 1, '2026-04-01', null,
   'quarterly', '{"description":"15 Jun / 15 Sep / 15 Dec / 15 Mar","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000107', null, '50000000-0000-4000-8000-000000000007', 1, '2026-04-01', null,
   'annual', '{"description":"30 Sep following FY","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000108', null, '50000000-0000-4000-8000-000000000008', 1, '2026-04-01', null,
   'annual', '{"description":"Within 6 months of FY end (AGM)","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-000000000109', null, '50000000-0000-4000-8000-000000000009', 1, '2026-04-01', null,
   'annual', '{"description":"30 days from AGM","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-00000000010a', null, '50000000-0000-4000-8000-00000000000a', 1, '2026-04-01', null,
   'annual', '{"description":"60 days from AGM","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-00000000010b', null, '50000000-0000-4000-8000-00000000000b', 1, '2026-04-01', null,
   'custom', '{"description":"State/jurisdiction-specific schedule (no single nationwide PT rule modelled, DM-27)","provenance":"architecture-matrix","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-00000000010c', null, '50000000-0000-4000-8000-00000000000c', 1, '2026-04-01', null,
   'monthly', '{"description":"15th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-00000000010d', null, '50000000-0000-4000-8000-00000000000d', 1, '2026-04-01', null,
   'monthly', '{"description":"15th of following month","provenance":"fixture-demo-mapping","statutoryValidation":"pending-external-ca-signoff"}', 'draft', 'pending', null),
  ('50000000-0000-4000-8000-00000000010e', null, '50000000-0000-4000-8000-00000000000e', 1, '2026-04-01', null,
   'custom', '{"description":"Per configured schedule","provenance":"architecture-matrix","statutoryValidation":"not-applicable"}', 'draft', 'not_required', null)
on conflict (compliance_type_id, version) do nothing;
