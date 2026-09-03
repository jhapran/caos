/**
 * IMP-022 — Client 360 adapter selector (MIG-DS-02).
 *
 * One public contract, two implementations, chosen once through the same
 * data-source boundary as every other domain. Consumers import
 * `client360Service` from `@/data` — never either implementation.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it
 * imports the demo TEAM roster (@/data/clients) and is covered by the
 * explicit allowlist in tests/unit/import-boundary.test.ts. Bundle-level
 * fixture exclusion stays deferred per MIG-DS-06a / MIG-VFY-E (Phase E);
 * runtime isolation holds because the fixture adapter never constructs
 * the Supabase client and the Supabase adapter never reads fixture data.
 */
import { getDataSource } from '@/data/source';

import { fixtureClient360 } from './fixture';
import { supabaseClient360 } from './supabase';
import type { Client360Service } from './types';

export const client360Service: Client360Service =
  getDataSource() === 'supabase' ? supabaseClient360 : fixtureClient360;
