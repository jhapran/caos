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

// Declared fixture bridges: adapter files whose entire job is serving the
// demo track, and which may therefore read fixture modules. Everything else
// on the production path must not. Bundle-level fixture exclusion from the
// production build stays deferred per MIG-DS-06a / MIG-VFY-E (Phase E).
const FIXTURE_BRIDGES = new Set([
  join(SRC, 'data', 'clientHierarchy', 'fixture.ts'),
  join(SRC, 'data', 'engagements', 'fixture.ts'),
  join(SRC, 'data', 'client360', 'fixture.ts'),
  join(SRC, 'data', 'complianceInstances', 'fixture.ts'),
  join(SRC, 'data', 'tasks', 'fixture.ts'),
  join(SRC, 'data', 'review', 'fixture.ts'),
  join(SRC, 'data', 'alerts', 'fixture.ts'),
  join(SRC, 'data', 'mywork', 'fixture.ts'),
  join(SRC, 'data', 'dashboard', 'fixture.ts'),
  join(SRC, 'data', 'search', 'fixture.ts'),
  join(SRC, 'data', 'deadlines', 'fixture.ts'),
]);

// All 12 dual-mode domain service folders (IMP-070 — the parity/boundary
// suites must enumerate every one explicitly so they cannot pass vacuously
// if a folder is dropped from the scan list; discovery LOW-3).
const DOMAIN_FOLDERS = [
  'clientHierarchy',
  'engagements',
  'client360',
  'complianceRules',
  'complianceInstances',
  'tasks',
  'review',
  'alerts',
  'mywork',
  'dashboard',
  'search',
  'deadlines',
];

// True when a specifier references a legacy flat fixture module
// (src/data/<mod>) as opposed to a same-name production module inside a
// domain subfolder.
function isFixtureRef(spec: string, file: string): boolean {
  const leaf = spec.split('/').pop() ?? spec;
  if (!FIXTURE_MODULES.has(leaf)) return false;
  return (
    spec === `@/data/${leaf}` ||
    ((spec === `./${leaf}` || spec === `../${leaf}`) &&
      (dirname(file) === join(SRC, 'data') || dirname(file) === SRC))
  );
}

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
    ...tsFiles(join(SRC, 'data', 'clientHierarchy')),
    ...tsFiles(join(SRC, 'data', 'engagements')),
    ...tsFiles(join(SRC, 'data', 'client360')),
    ...tsFiles(join(SRC, 'data', 'complianceRules')),
    ...tsFiles(join(SRC, 'data', 'complianceInstances')),
    ...tsFiles(join(SRC, 'data', 'tasks')),
    ...tsFiles(join(SRC, 'data', 'review')),
    ...tsFiles(join(SRC, 'data', 'alerts')),
    ...tsFiles(join(SRC, 'data', 'mywork')),
    ...tsFiles(join(SRC, 'data', 'dashboard')),
    ...tsFiles(join(SRC, 'data', 'search')),
    ...tsFiles(join(SRC, 'data', 'deadlines')),
    ...tsFiles(join(SRC, 'data', 'realtime')),
    join(SRC, 'data', 'source.ts'),
    join(SRC, 'data', 'errors.ts'),
    join(SRC, 'data', 'context.ts'),
    ...tsFiles(join(SRC, 'lib')),
  ];

  it('scans the Client 360 adapter modules (IMP-022)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'client360', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'client360', 'fixture.ts'));
  });

  it('scans the compliance-rules adapter modules (IMP-030)', () => {
    expect(productionFiles).toContain(join(SRC, 'data', 'complianceRules', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'complianceRules', 'fixture.ts'));
  });

  it('scans the compliance profiles/instances adapter modules (IMP-031)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'complianceInstances', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'complianceInstances', 'fixture.ts'));
  });

  it('scans the tasks adapter modules (IMP-040)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'tasks', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'tasks', 'fixture.ts'));
  });

  it('scans the review-queue adapter modules (IMP-041)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'review', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'review', 'fixture.ts'));
  });

  it('scans the alerts adapter modules (IMP-042)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'alerts', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'alerts', 'fixture.ts'));
  });

  it('scans the My Work adapter modules (IMP-042)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'mywork', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'mywork', 'fixture.ts'));
  });

  it('scans the dashboard adapter modules (IMP-060)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'dashboard', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'dashboard', 'fixture.ts'));
  });

  it('scans the structured-search adapter modules (IMP-061)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'search', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'search', 'fixture.ts'));
  });

  it('scans the realtime channel module (IMP-062)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'realtime', 'hub.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'realtime', 'subscribe.ts'));
  });

  it('scans the engagement adapter modules (IMP-021)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(join(SRC, 'data', 'engagements', 'supabase.ts'));
    expect(productionFiles).toContain(join(SRC, 'data', 'engagements', 'fixture.ts'));
  });

  it('scans the client-hierarchy adapter modules (IMP-020)', () => {
    // Guards against the scan passing vacuously if the folder moves.
    expect(productionFiles).toContain(
      join(SRC, 'data', 'clientHierarchy', 'supabase.ts'),
    );
    expect(productionFiles).toContain(
      join(SRC, 'data', 'clientHierarchy', 'fixture.ts'),
    );
  });

  it('the fixture bridge imports fixtures but nothing else on the path does', () => {
    // The bridge exists so demo data has exactly one importer on the
    // adapter path; pin that property explicitly.
    const bridgeSpecs = specifiersOf(
      join(SRC, 'data', 'clientHierarchy', 'fixture.ts'),
    );
    expect(bridgeSpecs).toContain('@/data/clients');
  });

  it('no production adapter module imports fixture/demo modules', () => {
    const violations: string[] = [];
    for (const file of productionFiles) {
      if (FIXTURE_BRIDGES.has(file)) continue;
      for (const spec of specifiersOf(file)) {
        // A fixture reference is one that resolves to src/data/<mod> itself
        // — not a same-name module inside a production subfolder (e.g.
        // tenancy/types.ts is a production module).
        if (isFixtureRef(spec, file)) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('import boundary — non-vacuity guards (IMP-070, discovery LOW-3)', () => {
  const productionFiles = [
    ...tsFiles(join(SRC, 'data', 'auth')),
    ...tsFiles(join(SRC, 'data', 'tenancy')),
    ...DOMAIN_FOLDERS.flatMap((folder) => tsFiles(join(SRC, 'data', folder))),
    ...tsFiles(join(SRC, 'data', 'realtime')),
    join(SRC, 'data', 'source.ts'),
    join(SRC, 'data', 'errors.ts'),
    join(SRC, 'data', 'context.ts'),
    ...tsFiles(join(SRC, 'lib')),
  ];

  it('enumerates exactly the 12 dual-mode domain service folders', () => {
    // The scan must cover every domain folder; a folder silently dropped
    // from the scan list (the LOW-3 defect for deadlines/) must fail here.
    expect(DOMAIN_FOLDERS).toHaveLength(12);
    for (const folder of DOMAIN_FOLDERS) {
      expect(productionFiles).toContain(join(SRC, 'data', folder, 'fixture.ts'));
      expect(productionFiles).toContain(join(SRC, 'data', folder, 'supabase.ts'));
    }
  });

  it('FIXTURE_BRIDGES is exactly the set of fixture adapters importing legacy fixture modules', () => {
    // Non-vacuity: the bridge exemption list can be neither under-listed
    // (a bridge importing fixtures unlisted would violate the boundary) nor
    // over-listed (an entry for an adapter importing nothing would hide a
    // folder silently dropped from the scan).
    const importers = DOMAIN_FOLDERS
      .map((folder) => join(SRC, 'data', folder, 'fixture.ts'))
      .filter((file) => specifiersOf(file).some((spec) => isFixtureRef(spec, file)));
    expect([...FIXTURE_BRIDGES].sort()).toEqual(importers.sort());
  });

  it('complianceRules/fixture.ts is covered and imports zero legacy fixture modules', () => {
    // LOW-3: this adapter is self-contained, so it never appears in a
    // legacy-import-derived list — pin its coverage explicitly.
    const file = join(SRC, 'data', 'complianceRules', 'fixture.ts');
    expect(productionFiles).toContain(file);
    expect(FIXTURE_BRIDGES.has(file)).toBe(false);
    expect(specifiersOf(file).filter((spec) => isFixtureRef(spec, file))).toEqual([]);
  });

  it('deadlines/fixture.ts is covered as a declared bridge importing legacy fixture modules', () => {
    // LOW-3: the deadlines folder was absent from the scan list; it is a
    // legitimate bridge (derives demo rows from the legacy deadline and
    // dependency fixture modules) and must be pinned as covered.
    const file = join(SRC, 'data', 'deadlines', 'fixture.ts');
    expect(productionFiles).toContain(file);
    expect(FIXTURE_BRIDGES.has(file)).toBe(true);
    const legacyRefs = specifiersOf(file).filter((spec) => isFixtureRef(spec, file));
    expect(legacyRefs.length).toBeGreaterThan(0);
  });
});
