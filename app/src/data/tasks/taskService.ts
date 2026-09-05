/**
 * IMP-040 — Tasks, dependencies, checklists, comments adapter selector
 * (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as
 * auth, tenancy, the client hierarchy, engagements, the compliance
 * catalogue, and compliance profiles/instances. Consumers import
 * `taskService` from `@/data` — never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it
 * composes the IMP-020/030/031 fixture singletons
 * (@/data/clientHierarchy/fixture, @/data/complianceRules/fixture,
 * @/data/complianceInstances/fixture) and the demo roster
 * (@/data/clients TEAM), and is covered by the explicit allowlist in
 * tests/unit/import-boundary.test.ts. Static bundle-level exclusion of
 * fixture code from the production build remains deferred per MIG-DS-06a /
 * MIG-VFY-E (Phase E); runtime isolation is guaranteed because the fixture
 * adapter never constructs the Supabase client and the Supabase adapter
 * never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureTasks } from './fixture';
import { supabaseTasks } from './supabase';
import type { TaskService } from './types';

export const taskService: TaskService =
  getDataSource() === 'supabase' ? supabaseTasks : fixtureTasks;
