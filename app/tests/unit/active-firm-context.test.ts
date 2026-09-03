/**
 * IMP-022 closure — resolveDefaultActiveFirm (RLS-CTX-02).
 *
 * Proves the temporary R0 default-firm rule is deterministic and
 * active-only:
 *   - independent of membership array / insertion order
 *   - only status 'active' is eligible
 *   - null when no active membership exists
 */
import { describe, expect, it } from 'vitest';

import { resolveDefaultActiveFirm } from '@/data/context';

const FIRM_LOW = '00000000-0000-4000-8000-000000000001';
const FIRM_MID = '00000000-0000-4000-8000-000000000002';
const FIRM_HIGH = '00000000-0000-4000-8000-000000000003';

describe('resolveDefaultActiveFirm', () => {
  it('returns null for an empty membership list', () => {
    expect(resolveDefaultActiveFirm([])).toBeNull();
  });

  it('returns the single active membership firm', () => {
    expect(
      resolveDefaultActiveFirm([{ firmId: FIRM_MID, status: 'active' }]),
    ).toBe(FIRM_MID);
  });

  it('picks the lexicographically smallest active firm id', () => {
    expect(
      resolveDefaultActiveFirm([
        { firmId: FIRM_HIGH, status: 'active' },
        { firmId: FIRM_LOW, status: 'active' },
        { firmId: FIRM_MID, status: 'active' },
      ]),
    ).toBe(FIRM_LOW);
  });

  it('is independent of membership array order (insertion reversed)', () => {
    const forward = [
      { firmId: FIRM_LOW, status: 'active' },
      { firmId: FIRM_MID, status: 'active' },
      { firmId: FIRM_HIGH, status: 'active' },
    ];
    const reversed = [...forward].reverse();
    const shuffled = [forward[1], forward[2], forward[0]];
    const first = resolveDefaultActiveFirm(forward);
    expect(resolveDefaultActiveFirm(reversed)).toBe(first);
    expect(resolveDefaultActiveFirm(shuffled)).toBe(first);
    expect(resolveDefaultActiveFirm(forward)).toBe(
      resolveDefaultActiveFirm(forward),
    );
  });

  it('never selects invited, suspended, or removed memberships', () => {
    expect(
      resolveDefaultActiveFirm([
        { firmId: FIRM_LOW, status: 'invited' },
        { firmId: FIRM_MID, status: 'suspended' },
        { firmId: FIRM_HIGH, status: 'removed' },
      ]),
    ).toBeNull();
  });

  it('ignores non-active rows when an active one exists', () => {
    expect(
      resolveDefaultActiveFirm([
        { firmId: FIRM_LOW, status: 'suspended' },
        { firmId: FIRM_MID, status: 'active' },
        { firmId: FIRM_HIGH, status: 'invited' },
      ]),
    ).toBe(FIRM_MID);
  });

  it('does not mutate the caller-provided array', () => {
    const memberships = [
      { firmId: FIRM_HIGH, status: 'active' },
      { firmId: FIRM_LOW, status: 'active' },
    ];
    resolveDefaultActiveFirm(memberships);
    expect(memberships[0].firmId).toBe(FIRM_HIGH);
  });
});
