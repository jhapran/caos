/**
 * IMP-031 — Compliance profiles & instances barrel: the stable public
 * contract plus the selected adapter. Implementation modules (./fixture,
 * ./supabase) are internal — never import them from consumers.
 */
export { complianceInstancesService } from './complianceInstancesService';
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
} from './types';
