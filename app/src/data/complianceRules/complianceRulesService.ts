/**
 * IMP-030 — Compliance types & rule versions adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as
 * auth, tenancy, the client hierarchy, and engagements. Consumers import
 * `complianceRulesService` from `@/data` — never either implementation
 * directly.
 *
 * NOTE (boundary audit): ./fixture is self-contained (its catalogue mirror
 * is declared inline; it imports NO legacy demo fixture modules), so this
 * module needs no fixture-bridge allowlist entry in
 * tests/unit/import-boundary.test.ts. Runtime isolation is guaranteed: the
 * fixture adapter never constructs the Supabase client and the Supabase
 * adapter never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureComplianceRules } from './fixture';
import { supabaseComplianceRules } from './supabase';
import type { ComplianceRulesService } from './types';

export const complianceRulesService: ComplianceRulesService =
  getDataSource() === 'supabase' ? supabaseComplianceRules : fixtureComplianceRules;
