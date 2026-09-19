/**
 * IMP-060 / API-OQ-03 spike — PURE parser self-test for
 * parseExactCountTotal() (the HIGH-4 correction).
 *
 * Zero network, zero DB, zero file mutation: exercises synthetic
 * (status, Content-Range) pairs in memory only.
 *
 * Usage (from app/): node scripts/spikes/api-oq-03/selftest.mjs
 */
import { parseExactCountTotal } from './lib.mjs';

const cases = [
  // [label, status, contentRange, expected: number | 'REJECT']
  ['206 partial, empty range, numeric total (the observed run-4 response)', 206, '*/10000', 10000],
  ['206 partial, ranged rows, numeric total', 206, '0-999/10000', 10000],
  ['200 full range, wildcard range, numeric total', 200, '*/600', 600],
  ['200 full range, ranged rows, numeric total', 200, '0-49/600', 600],
  ['200 zero total', 200, '*/0', 0],
  ['206 missing Content-Range', 206, null, 'REJECT'],
  ['206 empty Content-Range', 206, '', 'REJECT'],
  ['206 wildcard/unknown total', 206, '*/*', 'REJECT'],
  ['200 wildcard/unknown total', 200, '*/*', 'REJECT'],
  ['206 malformed header (garbage)', 206, 'garbage', 'REJECT'],
  ['206 malformed header (no slash)', 206, '10000', 'REJECT'],
  ['206 non-numeric total', 206, '*/abc', 'REJECT'],
  ['206 negative total', 206, '*/-5', 'REJECT'],
  ['206 trailing junk', 206, '*/10000 extra', 'REJECT'],
  ['206 unsafe-integer total', 206, '*/99999999999999999999', 'REJECT'],
  ['400 with valid-looking Content-Range', 400, '*/10000', 'REJECT'],
  ['401 unauthenticated', 401, null, 'REJECT'],
  ['403 forbidden', 403, null, 'REJECT'],
  ['404 not found', 404, null, 'REJECT'],
  ['416 range not satisfiable', 416, '*/10000', 'REJECT'],
  ['500 server error', 500, '*/10000', 'REJECT'],
  ['201 unexpected success status', 201, '*/1', 'REJECT'],
  ['204 unexpected success status', 204, null, 'REJECT'],
];

let failed = 0;
for (const [label, status, contentRange, expected] of cases) {
  let outcome;
  try {
    outcome = parseExactCountTotal(status, contentRange);
  } catch {
    outcome = 'REJECT';
  }
  const pass = outcome === expected;
  if (!pass) failed += 1;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}: status=${status} range=${JSON.stringify(contentRange)} -> ${outcome} (expected ${expected})`);
}

console.log(`EXACT_COUNT_PARSER_CASES=${cases.length} FAILURES=${failed}`);
console.log(failed === 0 ? 'SELFTEST=PASS' : 'SELFTEST=FAIL');
process.exit(failed === 0 ? 0 : 1);
