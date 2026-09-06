/**
 * IMP-042 (data-adapter slice) — My Work adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as the
 * other IMP domains. Consumers import `myworkService` from `@/data` —
 * never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it reads
 * the legacy demo fixture modules (@/data/tasks TASKS + DEMO_TODAY,
 * @/data/review REVIEW_ITEMS, @/data/clients), and is covered by the
 * explicit allowlist in tests/unit/import-boundary.test.ts. Static
 * bundle-level exclusion of fixture code from the production build remains
 * deferred per MIG-DS-06a / MIG-VFY-E (Phase E); runtime isolation is
 * guaranteed because the fixture adapter never constructs the Supabase
 * client and the Supabase adapter never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureMyWork } from './fixture';
import { supabaseMyWork } from './supabase';
import type { MyWorkService } from './types';

export const myworkService: MyWorkService =
  getDataSource() === 'supabase' ? supabaseMyWork : fixtureMyWork;
