/**
 * IMP-030 — Compliance types & rule versions barrel: the stable public
 * contract plus the selected adapter. Implementation modules (./fixture,
 * ./supabase) are internal — never import them from consumers.
 */
export { complianceRulesService } from './complianceRulesService';
export type {
  ActivateRuleVersionResult,
  ComplianceFrequency,
  ComplianceRulesService,
  ComplianceRuleVersionRecord,
  ComplianceScopeKind,
  ComplianceTypeListFilter,
  ComplianceTypeRecord,
  ComplianceTypeStatus,
  CreateComplianceTypeInput,
  CreateRuleVersionInput,
  DomainApprovalStatus,
  GovernanceClass,
  RulePayload,
  RuleVersionListFilter,
  RuleVersionStatus,
  UpdateComplianceTypeInput,
  UpdateRuleVersionDraftInput,
} from './types';
