/**
 * IMP-041 PASS C — Review queue adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as
 * auth, tenancy, the client hierarchy, engagements, the compliance
 * catalogue, compliance profiles/instances, and tasks. Consumers import
 * `reviewService` from `@/data` — never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it
 * composes the IMP-020/031/040 fixture singletons
 * (@/data/clientHierarchy/fixture, @/data/complianceInstances/fixture,
 * @/data/tasks/fixture) and the legacy demo review fixture
 * (@/data/review), and is covered by the explicit allowlist in
 * tests/unit/import-boundary.test.ts. Static bundle-level exclusion of
 * fixture code from the production build remains deferred per MIG-DS-06a /
 * MIG-VFY-E (Phase E); runtime isolation is guaranteed because the fixture
 * adapter never constructs the Supabase client and the Supabase adapter
 * never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureReview } from './fixture';
import { supabaseReview } from './supabase';
import type { ReviewService } from './types';

export const reviewService: ReviewService =
  getDataSource() === 'supabase' ? supabaseReview : fixtureReview;
