/**
 * IMP-061 (data-adapter slice) — Structured search barrel: the stable
 * public contract plus the selected adapter. Implementation modules
 * (./fixture, ./supabase) are internal — never import them from consumers.
 */
export { searchService } from './searchService';
export { STRUCTURED_SEARCH_MIN_QUERY_LENGTH } from './types';
export type {
  SearchMatchClass,
  SearchService,
  StructuredSearchHit,
  StructuredSearchKind,
} from './types';
