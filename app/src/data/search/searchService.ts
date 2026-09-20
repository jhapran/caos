/**
 * IMP-061 (data-adapter slice) — Structured search adapter selector
 * (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as the
 * other IMP domains. Consumers import `searchService` from `@/data` —
 * never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it reads
 * the legacy demo fixture modules (@/data/clients CLIENTS/TEAM), the same
 * demo-track provenance as the other IMP fixture adapters. The Supabase
 * adapter never reads fixture data and the fixture adapter never constructs
 * the Supabase client. No naming hazard: there is no legacy flat
 * src/data/search.ts module.
 */
import { getDataSource } from '@/data/source';

import { fixtureSearch } from './fixture';
import { supabaseSearch } from './supabase';
import type { SearchService } from './types';

export const searchService: SearchService =
  getDataSource() === 'supabase' ? supabaseSearch : fixtureSearch;
