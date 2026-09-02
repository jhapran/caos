/**
 * IMP-020 — Client-hierarchy barrel: the stable public contract plus the
 * selected adapter. Implementation modules (./fixture, ./supabase) are
 * internal — never import them from consumers.
 */
export { clientHierarchyService } from './clientHierarchyService';
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
  LegalEntityType,
  LegalEntityRecord,
  LegalEntityStatus,
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
} from './types';
