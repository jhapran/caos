/**
 * IMP-014 — Data-source resolver: the single authoritative selection
 * boundary (MIG-DS-02/03/05/06c, OPS-ENV-06). TEST-MIG-08.
 *
 * Fail-closed matrix + chosen-once caching. Each case runs against a
 * fresh module graph with a stubbed env so the resolver cache never leaks
 * between cases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshResolver() {
  vi.resetModules();
  return import('@/data/source');
}

/**
 * Class identity cannot be used across vi.resetModules() (each fresh
 * module graph gets its own ConfigurationError class), so assert on the
 * stable error name + message instead.
 */
function expectConfigurationError(fn: () => unknown, pattern: RegExp) {
  try {
    fn();
  } catch (error) {
    expect((error as Error).name).toBe('ConfigurationError');
    expect((error as Error).message).toMatch(pattern);
    return;
  }
  expect.unreachable('expected a ConfigurationError to be thrown');
}

describe('data-source resolver (TEST-MIG-08)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('resolves fixture mode explicitly (demo track — intentional, not a fallback)', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'fixture');
    const source = await freshResolver();
    expect(source.getDataSource()).toBe('fixture');
    expect(source.validateStartupConfig()).toBe('fixture');
  });

  it('fixture mode needs no Supabase configuration whatsoever', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'fixture');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const source = await freshResolver();
    expect(() => source.validateStartupConfig()).not.toThrow();
  });

  it('resolves supabase mode with complete client-safe config', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-placeholder');
    const source = await freshResolver();
    expect(source.validateStartupConfig()).toBe('supabase');
  });

  it('unset VITE_DATA_SOURCE is a hard ConfigurationError — no default mode (MIG-DS-05)', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', undefined as unknown as string);
    const source = await freshResolver();
    expectConfigurationError(() => source.getDataSource(), /MIG-DS-05/);
  });

  it.each(['', '   ', 'FIXTURE', 'SUPABASE', 'Supabase', 'staging', 'demo', 'fixture ', '  supabase\t'])(
    'value %j is a hard ConfigurationError unless it trims to an exact mode',
    async (value) => {
      vi.stubEnv('VITE_DATA_SOURCE', value);
      const source = await freshResolver();
      if (value.trim() === 'fixture' || value.trim() === 'supabase') {
        expect(source.getDataSource()).toBe(value.trim());
      } else {
        expectConfigurationError(() => source.getDataSource(), /MIG-DS-05/);
      }
    },
  );

  it('supabase mode with missing URL/anon key fails closed at startup — never fixture (MIG-DS-03)', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const source = await freshResolver();
    expectConfigurationError(() => source.validateStartupConfig(), /MIG-DS-03/);
  });

  it.each([
    ['URL missing', '', 'anon-key-placeholder'],
    ['public key missing', 'http://127.0.0.1:54321', ''],
    ['both missing', '', ''],
  ])(
    'supabase mode with %s fails closed and NEVER falls back to fixture',
    async (_label, url, key) => {
      vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
      vi.stubEnv('VITE_SUPABASE_URL', url);
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
      const source = await freshResolver();
      expectConfigurationError(() => source.validateStartupConfig(), /MIG-DS-03/);
      // The mode itself still resolves to supabase — a broken production
      // config can never silently become the demo track.
      expect(source.getDataSource()).toBe('supabase');
    },
  );

  it('the adapter is chosen once: a later env change never switches mode (MIG-DS-06c)', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-placeholder');
    const source = await freshResolver();
    expect(source.getDataSource()).toBe('supabase');
    // Runtime tampering / late env mutation must not flip the selection.
    vi.stubEnv('VITE_DATA_SOURCE', 'fixture');
    expect(source.getDataSource()).toBe('supabase');
  });

  it('an invalid value keeps throwing — it is never cached as a mode', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'bogus');
    const source = await freshResolver();
    expectConfigurationError(() => source.getDataSource(), /MIG-DS-05/);
    expectConfigurationError(() => source.getDataSource(), /MIG-DS-05/);
  });
});
