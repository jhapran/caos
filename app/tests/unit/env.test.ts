/**
 * IMP-011/IMP-014 — Client-safe env configuration (OPS-ENV-02, MIG-DS-02/03).
 *
 * Low-level parsing/reading only; resolver policy (fail-closed startup,
 * caching) is covered by tests/unit/data-source.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSupabaseConfig,
  getSupabaseConfig,
  parseDataSource,
} from '@/lib/env';

describe('env configuration — raw parsing (IMP-014)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('parses the two exact approved mode names', () => {
    expect(parseDataSource('fixture')).toBe('fixture');
    expect(parseDataSource('supabase')).toBe('supabase');
  });

  it('tolerates surrounding whitespace only', () => {
    expect(parseDataSource('  fixture\n')).toBe('fixture');
  });

  it('rejects unset, empty, and whitespace-only values (MIG-DS-05)', () => {
    expect(parseDataSource(undefined)).toBeNull();
    expect(parseDataSource('')).toBeNull();
    expect(parseDataSource('   ')).toBeNull();
  });

  it('rejects unknown and mixed-case values — no fuzzy matching (MIG-DS-05)', () => {
    expect(parseDataSource('FIXTURE')).toBeNull();
    expect(parseDataSource('Supabase')).toBeNull();
    expect(parseDataSource('staging')).toBeNull();
    expect(parseDataSource('production')).toBeNull();
    expect(parseDataSource('fixture,supabase')).toBeNull();
  });

  it('reads the raw value lazily from import.meta.env', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    const env = await import('@/lib/env');
    expect(env.readDataSourceRaw()).toBe('supabase');
  });

  it('assertSupabaseConfig hard-fails when client-safe config is missing (MIG-DS-03)', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    expect(getSupabaseConfig()).toBeNull();
    expect(() => assertSupabaseConfig()).toThrow(/MIG-DS-03/);
  });

  it('missing either URL or anon key is incomplete config', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    let env = await import('@/lib/env');
    expect(env.getSupabaseConfig()).toBeNull();

    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-placeholder');
    env = await import('@/lib/env');
    expect(env.getSupabaseConfig()).toBeNull();
  });

  it('complete URL + anon key returns the client-safe config', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-placeholder');
    const env = await import('@/lib/env');
    expect(env.assertSupabaseConfig()).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon-key-placeholder',
    });
  });
});
