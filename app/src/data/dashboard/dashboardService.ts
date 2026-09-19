/**
 * IMP-060 — Dashboard aggregates adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as the
 * other IMP domains. Consumers import `dashboardService` from `@/data` —
 * never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it reads
 * the legacy demo fixture modules (@/data/tasks AGGREGATES,
 * @/data/deadlines getDeadlineGroups, @/data/review REVIEW_ITEMS,
 * @/data/alerts ALERTS), and is covered by the explicit allowlist in
 * tests/unit/import-boundary.test.ts. Static bundle-level exclusion of
 * fixture code from the production build remains deferred per
 * MIG-DS-06a / MIG-VFY-E (Phase E); runtime isolation is guaranteed because
 * the fixture adapter never constructs the Supabase client and the Supabase
 * adapter never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureDashboard } from './fixture';
import { supabaseDashboard } from './supabase';
import type { DashboardService } from './types';

export const dashboardService: DashboardService =
  getDataSource() === 'supabase' ? supabaseDashboard : fixtureDashboard;
