/**
 * IMP-014 — Permanent import-boundary enforcement (API-ARCH-01/02,
 * MIG-DS-06a). Executable, so violations fail CI/harness rather than
 * relying on code review.
 *
 * Two invariants:
 *
 * 1. UI layer (src/pages, src/components) must NEVER import the Supabase
 *    SDK, the browser client, or raw env config — the @/data boundary is
 *    the only data path. (@/lib/utils cn() is allowed: pure styling.)
 *
 * 2. The production adapter path (auth, tenancy, source, errors, lib)
 *    must NEVER import fixture/demo modules — supabase mode cannot serve
 *    fixture records as production data (TEST-MIG-07 skeleton).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const tsFiles = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f));

const IMPORTS = /(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(IMPORTS)].map((m) => m[1]);
}

// Fixture/demo-track modules (API-INV-01: KEEP/EVOLVE/REPLACE/DEMO-ONLY —
// none of them may feed the production adapter path).
const FIXTURE_MODULES = new Set([
  'clients',
  'compliance',
  'tasks',
  'deadlines',
  'review',
  'alerts',
  'dependency',
  'askCaos',
  'api',
  'store',
  'types',
]);

describe('import boundary — UI layer (API-ARCH-01/02)', () => {
  const uiFiles = [
    ...tsFiles(join(SRC, 'pages')),
    ...tsFiles(join(SRC, 'components')),
  ];

  it('scans a non-trivial UI surface', () => {
    expect(uiFiles.length).toBeGreaterThan(50);
  });

  it('no page/component imports the Supabase SDK, browser client, or env config', () => {
    const violations: string[] = [];
    for (const file of uiFiles) {
      for (const spec of specifiersOf(file)) {
        if (
          spec.includes('@supabase/') ||
          spec.includes('supabaseClient') ||
          spec === '@/lib/env' ||
          spec.endsWith('/lib/env')
        ) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no page/component reads import.meta.env — config access is the data layer only', () => {
    // Direct env reads would let UI code perform its own provider
    // selection, bypassing the single boundary in src/data/source.ts.
    const violations: string[] = [];
    for (const file of uiFiles) {
      if (readFileSync(file, 'utf8').includes('import.meta.env')) {
        violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('import boundary — production adapter path (TEST-MIG-07)', () => {
  const productionFiles = [
    ...tsFiles(join(SRC, 'data', 'auth')),
    ...tsFiles(join(SRC, 'data', 'tenancy')),
    join(SRC, 'data', 'source.ts'),
    join(SRC, 'data', 'errors.ts'),
    ...tsFiles(join(SRC, 'lib')),
  ];

  it('no production adapter module imports fixture/demo modules', () => {
    const violations: string[] = [];
    for (const file of productionFiles) {
      for (const spec of specifiersOf(file)) {
        // A fixture reference is one that resolves to src/data/<mod> itself
        // — not a same-name module inside a production subfolder (e.g.
        // tenancy/types.ts is a production module).
        const leaf = spec.split('/').pop() ?? spec;
        if (!FIXTURE_MODULES.has(leaf)) continue;
        const isFixtureRef =
          spec === `@/data/${leaf}` ||
          ((spec === `./${leaf}` || spec === `../${leaf}`) &&
            (dirname(file) === join(SRC, 'data') || dirname(file) === SRC));
        if (isFixtureRef) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
