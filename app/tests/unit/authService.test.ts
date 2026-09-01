/**
 * IMP-011 — Auth service contract (fixture/demo track preserved).
 *
 * The supabase-mode implementation is exercised against the real local
 * stack by tests/integration/auth/*; here we pin the fixture contract the
 * demo deployment depends on, and that the default mode IS fixture.
 */
import { describe, expect, it } from 'vitest';

import { authService } from '@/data/auth/authService';

describe('authService — fixture mode (demo track, unchanged)', () => {
  it('selects the fixture implementation by default', () => {
    expect(authService.mode).toBe('fixture');
  });

  it('restores as the synthetic demo persona, always authenticated', async () => {
    const snapshot = await authService.restore();
    expect(snapshot.status).toBe('authenticated');
    expect(snapshot.user?.id).toBe('demo-fixture-user');
  });

  it('onChange is a no-op subscription that unsubscribes cleanly', () => {
    const unsubscribe = authService.onChange(() => {
      throw new Error('fixture mode must not emit auth-state changes');
    });
    expect(() => unsubscribe()).not.toThrow();
  });

  it('auth actions succeed as demo no-ops and carry no membership/role data', async () => {
    expect(await authService.signInPassword('a@b.c', 'x')).toEqual({ ok: true });
    expect(await authService.signInMagicLink('a@b.c', 'http://x')).toEqual({ ok: true });
    expect(await authService.requestPasswordReset('a@b.c', 'http://x')).toEqual({ ok: true });
    expect(await authService.updatePassword('new')).toEqual({ ok: true });
    const assurance = await authService.getAssurance();
    expect(assurance).toEqual({ aal: 'aal1', hasVerifiedTotpFactor: true });
    expect(assurance).not.toHaveProperty('firm_id');
    expect(assurance).not.toHaveProperty('role');
  });
});
