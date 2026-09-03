/**
 * IMP-022 — Display labels for the Client 360 vocabularies (presentation
 * only; the vocabularies themselves are owned by SCH-04…09 CHECKs).
 */
import type {
  ClientRiskRating,
  ClientStatus,
  LegalEntityStatus,
  LegalEntityType,
  RegistrationStatus,
  RelationType,
  RelationshipStatus,
} from '@/data';
import type { EngagementStatus, LetterStatus } from '@/data';

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  inactive: 'Inactive',
  offboarded: 'Offboarded',
};

export const RISK_LABEL: Record<ClientRiskRating, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const ENTITY_TYPE_LABEL: Record<LegalEntityType, string> = {
  private_limited: 'Private Limited',
  llp: 'LLP',
  individual: 'Individual',
  partnership: 'Partnership',
  trust: 'Trust',
  huf: 'HUF',
  other: 'Other',
};

export const ENTITY_STATUS_LABEL: Record<LegalEntityStatus, string> = {
  active: 'Active',
  dormant: 'Dormant',
  dissolved: 'Dissolved',
};

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  active: 'Active',
  surrendered: 'Surrendered',
  expired: 'Expired',
};

export const RELATION_TYPE_LABEL: Record<RelationType, string> = {
  group: 'Group',
  holding: 'Holding',
  subsidiary: 'Subsidiary',
  director: 'Director',
  partner: 'Partner',
  promoter: 'Promoter',
  related_party: 'Related party',
  family: 'Family',
};

export const RELATIONSHIP_STATUS_LABEL: Record<RelationshipStatus, string> = {
  active: 'Active',
  ended: 'Ended',
};

export const ENGAGEMENT_STATUS_LABEL: Record<EngagementStatus, string> = {
  draft: 'Draft',
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  terminated: 'Terminated',
};

export const LETTER_STATUS_LABEL: Record<LetterStatus, string> = {
  not_started: 'Not started',
  issued: 'Issued',
  signed: 'Signed',
  expired: 'Expired',
};
