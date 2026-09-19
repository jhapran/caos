/**
 * IMP-060 — Dashboard domain barrel (API-R0-DASH). No naming hazard (there
 * is no legacy flat `src/data/dashboard.ts` fixture module), so the parent
 * barrel wires the plain './dashboard' specifier (the client360/mywork
 * convention).
 */
export { dashboardService } from './dashboardService';
export {
  DASHBOARD_INSTANCE_STATES,
  DASHBOARD_TASK_STATES,
  emptyDashboardAggregates,
  OPEN_INSTANCE_STATES,
  zeroInstanceCounts,
  zeroTaskCounts,
} from './types';
export type { DashboardAggregates, DashboardService } from './types';
