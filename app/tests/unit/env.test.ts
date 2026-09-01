/**
 * IMP-011 — Client-safe env configuration (OPS-ENV-02, MIG-DS-02/03).
 *
 * The test environment has no VITE_DATA_SOURCE set, so the default module
 * state is the fixture/demo track; supabase-mode fail-closed behavior is
 * verified via stubbed env + fresh module imports.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertSupabaseConfig, DATA_SOURCE } from '@/lib/env';

describe('env configuration (IMP-011)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to the fixture demo track when VITE_DATA_SOURCE is unset', () => {
    expect(DATA_SOURCE).toBe('fixture');
  });

  it('assertSupabaseConfig hard-fails when client-safe config is missing (MIG-DS-03)', () => {
    expect(() => assertSupabaseConfig()).toThrow(/MIG-DS-03/);
  });

  it('supabase mode with missing URL/anon key is a hard startup error — no fallback', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const env = await import('@/lib/env');
    expect(env.DATA_SOURCE).toBe('supabase');
    expect(() => env.assertSupabaseConfig()).toThrow(/MIG-DS-03/);
  });

  it('supabase mode with URL + anon key returns the client-safe config', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-placeholder');
    const env = await import('@/lib/env');
    expect(env.assertSupabaseConfig()).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon-key-placeholder',
    });
  });
});
