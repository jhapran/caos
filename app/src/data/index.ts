// IMP-014 — Permanent data-access boundary (API-ARCH-01/02).
//
// React components/pages import ONLY from this barrel (or the ./auth and
// ./tenancy sub-module barrels) — never from @/lib/supabaseClient, the
// Supabase SDK, or provider implementation paths. One typed contract, two
// adapters (fixture demo track / Supabase production), selected once at
// startup through ./source (MIG-DS-02, fail-closed per MIG-DS-05).
//
// Fixture modules below are the demo track (TEN-20); their production
// replacements land per API-INV-01 classification with the IMP-020+
// domain packages.

// --- Stable production contracts (IMP-011/IMP-014) -------------------------
export { getDataSource, validateStartupConfig } from './source';
export type { DataSource } from './source';
export { ApiError, ConfigurationError, toApiError } from './errors';
export type { ApiErrorKind } from './errors';
// --- IMP-020: active-firm selector context + client hierarchy --------------
export { clearActiveFirm, getActiveFirm, resolveDefaultActiveFirm, setActiveFirm } from './context';
export { clientHierarchyService } from './clientHierarchy';
export type {
  ClientHierarchyService,
  ClientIdentity,
  ClientListFilter,
  ClientRecord,
  ClientRelationshipRecord,
  ClientRiskRating,
  ClientStatus,
  ContactRecord,
  ContactStatus,
  CreateClientInput,
  CreateClientRelationshipInput,
  CreateContactInput,
  CreateLegalEntityInput,
  CreateRegistrationInput,
  LegalEntityRecord,
  LegalEntityStatus,
  LegalEntityType,
  RegistrationRecord,
  RegistrationStatus,
  RegistrationType,
  RelationType,
  RelationshipStatus,
  UpdateClientInput,
  UpdateClientRelationshipInput,
  UpdateContactInput,
  UpdateLegalEntityInput,
  UpdateRegistrationInput,
} from './clientHierarchy';
// --- IMP-021: engagements ----------------------------------------------------
export { engagementService } from './engagements';
export type {
  CreateEngagementInput,
  EngagementListFilter,
  EngagementRecord,
  EngagementLetterStatus,
  EngagementService,
  EngagementStatus,
  LetterStatus,
  UpdateEngagementInput,
} from './engagements';
// --- IMP-030: compliance types & rule versions -------------------------------
export { complianceRulesService } from './complianceRules';
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
} from './complianceRules';
// --- IMP-031: compliance profiles & instances (API-R0-CCP / API-R0-CIN) ------
export { complianceInstancesService } from './complianceInstances';
export type {
  ComplianceInstanceRecord,
  ComplianceInstancesService,
  ComplianceInstanceState,
  CompliancePayload,
  ComplianceProfileRecord,
  ComplianceProfileStatus,
  CreateInstanceInput,
  CreateProfileInput,
  GenerationSource,
  InstanceListFilter,
  ProfileListFilter,
  TransitionInstanceInput,
  TransitionInstanceResult,
  UpdateInstanceInput,
  UpdateProfileInput,
} from './complianceInstances';
// --- IMP-040: tasks, dependencies, checklists, comments (API-R0-TSK) --------
// NAMING HAZARD: the extensionless specifier './tasks' resolves to the
// LEGACY flat fixture module src/data/tasks.ts (file-first resolution under
// "moduleResolution": "bundler") — it stays exported unchanged in the
// fixture block below. The IMP-040 domain folder src/data/tasks/ is
// therefore wired through its explicit sub-barrel path './tasks/index'.
// Consumers import taskService / these types from '@/data' exactly like the
// other IMP domains; nothing should ever import '@/data/tasks' expecting
// the folder (that specifier is and remains the legacy module).
export { taskService } from './tasks/index';
export type {
  AddTaskDependencyInput,
  AddTaskDependencyResult,
  CreateTaskInput,
  RemoveTaskDependencyResult,
  TaskChecklistItemRecord,
  TaskCommentRecord,
  TaskDependencyRecord,
  TaskDetail,
  TaskListFilter,
  TaskRecord,
  TaskService,
  TaskStatus,
  TransitionTaskInput,
  TransitionTaskResult,
  UpdateTaskInput,
} from './tasks/index';
// --- IMP-022: Client 360 composite read (API-R0-CLI, DM-X-02) ----------------
export { client360Service } from './client360';
export type {
  Client360Engagement,
  Client360Relationship,
  Client360Service,
  Client360View,
  StaffRef,
} from './client360';
export { tenancyService } from './tenancy';
export type {
  FirmMembershipView,
  MembershipRole,
  MembershipStatus,
  ProfileView,
  TenancyService,
} from './tenancy';
export { AuthProvider, useAuth, authService } from './auth';
export type {
  Aal,
  Assurance,
  AuthContextValue,
  AuthResult,
  AuthService,
  AuthSnapshot,
  AuthStatus,
  AuthUser,
  MfaEnrollResult,
} from './auth';

// --- Fixture demo track (unchanged) ----------------------------------------
export * from './types';
export * from './clients';
export * from './compliance';
export * from './tasks';
export * from './deadlines';
export * from './review';
export * from './alerts';
export * from './dependency';
export * from './askCaos';
export * from './api';
export { DemoStoreProvider, useDemoStore, useLiveAggregates } from './store';
export type { Toast } from './store';
