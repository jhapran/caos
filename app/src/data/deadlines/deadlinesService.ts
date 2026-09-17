/**
 * IMP-051 (data-adapter slice) — Deadlines adapter selector (MIG-DS-02).
 *
 * The single selection point for this domain: one public contract, two
 * implementations, chosen once through the same data-source boundary as the
 * other IMP domains. Consumers import `deadlinesService` from `@/data` —
 * never either implementation directly.
 *
 * NOTE (boundary audit): ./fixture is a declared fixture bridge — it reads
 * the legacy demo fixture modules (@/data/deadlines getDeadlineGroups /
 * getDeadlineClients, @/data/dependency DEPENDENCY_CLIENTS,
 * @/data/compliance, @/data/tasks), the same demo-track provenance as the
 * other IMP fixture adapters. The Supabase adapter never reads fixture
 * data and the fixture adapter never constructs the Supabase client.
 */
import { getDataSource } from '@/data/source';

import { fixtureDeadlines } from './fixture';
import { supabaseDeadlines } from './supabase';
import type { DeadlinesService } from './types';

export const deadlinesService: DeadlinesService =
  getDataSource() === 'supabase' ? supabaseDeadlines : fixtureDeadlines;
