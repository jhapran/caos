/**
 * IMP-042 (data-adapter slice) — Alerts barrel: the stable public contract
 * plus the selected adapter. Implementation modules (./fixture, ./supabase)
 * are internal — never import them from consumers.
 */
export { alertsService } from './alertsService';
export type {
  AlertListFilter,
  AlertRecord,
  AlertResolutionType,
  AlertRuleRecord,
  AlertsService,
  AlertSeverityKey,
  AlertStatus,
  AlertTransitionResult,
  CreateAlertRuleInput,
  UpdateAlertRuleInput,
} from './types';
