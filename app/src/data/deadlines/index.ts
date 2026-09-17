/**
 * IMP-051 (data-adapter slice) — Deadlines barrel: the stable public
 * contract plus the selected adapter. Implementation modules (./fixture,
 * ./supabase) are internal — never import them from consumers. The pure
 * group-id helpers are exported for tests and future UI slices.
 */
export { deadlinesService } from './deadlinesService';
export {
  DEADLINE_GROUP_ID_SEPARATOR,
  makeDeadlineGroupId,
  parseDeadlineGroupId,
} from './types';
export type {
  ClientDependencyKind,
  ClientDependencyRecord,
  DeadlineGroupRecord,
  DeadlineInstanceRecord,
  DeadlinesService,
} from './types';
