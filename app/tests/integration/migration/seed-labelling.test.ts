/**
 * IMP-070 — TEST-MIG-09 / MIG-SEED-06: seed-labelling NEGATIVE validation.
 *
 * This suite has NO stack dependence by design: it never calls localEnv(),
 * psql() or any helper that touches the local Supabase stack, and every
 * assertion below is executable with the stack DOWN.
 *
 * Proves:
 *  1. Refusal proof: scripts/harness/seed-harness.mjs hard-refuses a non-local
 *     API_URL discovered from `supabase status -o env`. A temp-dir FAKE `npx`
 *     shadows the real CLI on PATH and prints a hosted (and separately a LAN)
 *     API_URL with a garbage SERVICE_ROLE_KEY. The script must exit 1 with
 *     'Refusing to seed non-local Supabase' on stderr BEFORE any Auth Admin
 *     API call — the fake's invocation counter proves the discovery command
 *     ran exactly once and nothing else executed. The real local supabase
 *     CLI is never reached; no real hosted URL is ever contacted (the fake
 *     key is garbage and the refusal fires before the first fetch).
 *  2. supabase/seed.sql carries the local-only environment labelling
 *     (MIG-SEED-06): 'local' + 'never production seed data'.
 *  3. No seed tooling references fixture modules: every import/export
 *     specifier in scripts/**∙*.mjs is extracted and asserted to never
 *     resolve under src/ (the harness scripts import only node builtins and
 *     tests/integration/helpers.mjs); supabase/seed.sql carries no module
 *     reference at all (prose mention of the fixture→seed MAPPING is fine —
 *     that is documentation, not a module dependency).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// app/ root: tests/integration/migration/<this file> → up four levels.
const APP_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const NON_LOCAL_CASES = [
  'https://pyrniumcjcvagjygheyu.supabase.co', // hosted-style URL
  'http://192.168.1.50:54321', // LAN / non-loopback URL
];

function runSeedWithFakeNpx(apiUrl: string): { status: number | null; stderr: string; npxInvocations: number; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mig09-fake-npx-'));
  const counter = join(dir, 'counter');
  writeFileSync(counter, '');
  // The fake shadows the real `npx` on PATH: it records the invocation and
  // prints the `supabase status -o env` lines the discovery parser reads.
  const fake = join(dir, 'npx');
  writeFileSync(
    fake,
    '#!/bin/sh\n' +
      `echo x >> "${counter}"\n` +
      `printf '%s\\n' 'API_URL="${apiUrl}"'\n` +
      `printf '%s\\n' 'SERVICE_ROLE_KEY="00000000-fake-fake-fake-000000000000"'\n`,
  );
  chmodSync(fake, 0o755);

  const res = spawnSync('node', [join('scripts', 'harness', 'seed-harness.mjs')], {
    cwd: APP_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  const npxInvocations = readFileSync(counter, 'utf8').split('\n').filter(Boolean).length;
  return {
    status: res.status,
    stderr: res.stderr ?? '',
    npxInvocations,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('TEST-MIG-09 — harness seed hard-refuses non-local Supabase (MIG-SEED-06)', () => {
  it.each(NON_LOCAL_CASES)('refuses %s immediately after discovery, before any Auth Admin call', (apiUrl) => {
    const run = runSeedWithFakeNpx(apiUrl);
    try {
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('Refusing to seed non-local Supabase');
      expect(run.stderr).toContain(apiUrl);
      // The discovery command ran exactly ONCE and nothing else executed:
      // the refusal fires before listUsers()/createUser() — i.e. before any
      // Auth Admin API call (seed-harness.mjs: localEnv() → refusal → exit).
      expect(run.npxInvocations).toBe(1);
    } finally {
      run.cleanup();
    }
  });
});

describe('TEST-MIG-09 — seed.sql environment labelling (MIG-SEED-06)', () => {
  it('supabase/seed.sql is labelled local-only, never production seed data', () => {
    const seed = readFileSync(join(APP_ROOT, 'supabase', 'seed.sql'), 'utf8');
    expect(seed).toContain('MIG-SEED-06');
    expect(seed).toContain('local');
    expect(seed).toContain('never production seed data');
  });
});

describe('TEST-MIG-09 — no seed tooling references fixture modules', () => {
  it('no import/export/require specifier in scripts/**/*.mjs resolves under src/', () => {
    const listing = spawnSync(
      'find',
      [join(APP_ROOT, 'scripts'), '-name', '*.mjs', '-type', 'f'],
      { encoding: 'utf8' },
    );
    expect(listing.status).toBe(0);
    const files = listing.stdout.split('\n').filter(Boolean).sort();
    expect(files.length).toBeGreaterThan(0);

    const SPECIFIER =
      /(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])require\(\s*['"]([^'"]+)['"]\s*\)/g;
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(SPECIFIER)) {
        const spec = match[1] ?? match[2];
        // Module-reference patterns into the application source tree: the
        // '@/…' alias, any 'src/…' path segment, or a relative specifier
        // climbing into src (e.g. '../src/data', '../../src/data/clients').
        if (spec.startsWith('@/') || /(^|\/)src(\/|$)/.test(spec)) {
          offenders.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('supabase/seed.sql carries no module reference into the fixture layer', () => {
    const seed = readFileSync(join(APP_ROOT, 'supabase', 'seed.sql'), 'utf8');
    // SQL has no module system; a fixture dependency would have to appear as
    // an import/require specifier or an alias/path module reference. Prose
    // mention of the fixture→seed mapping (COMPLIANCE_MASTER, spec 10) is
    // documentation and is explicitly allowed.
    expect(seed).not.toMatch(/(?:^|[^.\w])require\(/);
    expect(seed).not.toMatch(/^\s*import\s/m);
    expect(seed).not.toContain('@/data');
    expect(seed).not.toMatch(/(?:\.\.\/)+src\/data/);
  });
});
