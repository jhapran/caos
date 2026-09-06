/**
 * IMP-042 (data-adapter slice) — Alerts adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as
 * auth, tenancy, the client hierarchy, engagements, the compliance
 * catalogue, compliance profiles/instances, tasks, and review. Consumers
 * import `alertsService` from `@/data` — never either implementation
 * directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it reads
 * the legacy demo alerts fixture (@/data/alerts), and is covered by the
 * explicit allowlist in tests/unit/import-boundary.test.ts. Static
 * bundle-level exclusion of fixture code from the production build remains
 * deferred per MIG-DS-06a / MIG-VFY-E (Phase E); runtime isolation is
 * guaranteed because the fixture adapter never constructs the Supabase
 * client and the Supabase adapter never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureAlerts } from './fixture';
import { supabaseAlerts } from './supabase';
import type { AlertsService } from './types';

export const alertsService: AlertsService =
  getDataSource() === 'supabase' ? supabaseAlerts : fixtureAlerts;
