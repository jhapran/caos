/**
 * IMP-060 / API-OQ-03 LOCAL measurement spike — standalone cleanup.
 * LOCAL ONLY; fail-closed. Applies teardown.sql and reports residue.
 *
 * Usage (from app/): node scripts/spikes/api-oq-03/teardown.mjs
 */
import { assertLocalSafety, psqlFile } from './lib.mjs';

assertLocalSafety();
console.log('== API-OQ-03 spike: standalone teardown ==');
const out = psqlFile('scripts/spikes/api-oq-03/teardown.sql');
console.log(out.trim().split('\n').map((l) => '  ' + l).join('\n'));
const bad = out.split('\n').filter((l) => /residue_\w+=[1-9]/.test(l));
if (bad.length > 0) {
  console.log(`CLEANUP_STATUS=RESIDUE ${bad.join(' | ')}`);
  process.exit(1);
}
console.log('CLEANUP_STATUS=PASS');
