/**
 * IMP-014 — Integration env for adapter-level tests.
 *
 * Adapter modules under test (src/data/*) resolve their mode through the
 * IMP-014 data-source boundary; here that boundary is pinned to supabase
 * mode against the LOCAL loopback stack only (never hosted). Values come
 * from the running local stack via the shared harness helper.
 */
import { vi } from 'vitest';

import { localEnv } from './helpers.mjs';

const { API_URL, ANON_KEY } = localEnv();

vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
vi.stubEnv('VITE_SUPABASE_URL', API_URL);
vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY);
