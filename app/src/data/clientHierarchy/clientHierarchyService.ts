/**
 * IMP-020 — Client-hierarchy adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as
 * auth and tenancy. Consumers import `clientHierarchyService` from
 * `@/data` — never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is the declared fixture bridge — it
 * imports demo fixtures (@/data/clients) and is covered by the explicit
 * allowlist in tests/unit/import-boundary.test.ts. Static bundle-level
 * exclusion of fixture code from the production build remains deferred
 * per MIG-DS-06a / MIG-VFY-E (Phase E); runtime isolation is guaranteed
 * because the fixture adapter never constructs the Supabase client and
 * the Supabase adapter never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureClientHierarchy } from './fixture';
import { supabaseClientHierarchy } from './supabase';
import type { ClientHierarchyService } from './types';

export const clientHierarchyService: ClientHierarchyService =
  getDataSource() === 'supabase' ? supabaseClientHierarchy : fixtureClientHierarchy;
