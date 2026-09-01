/**
 * Harness Gate — Auth integration tests (LOCAL Supabase GoTrue).
 *
 * Mechanism-level coverage of the TEST-AUTH core against the deterministic
 * IMP-003 identities. This is NOT complete production authentication
 * coverage: invitation (TEST-AUTH-01), password reset (04), magic link (05),
 * TOTP/MFA (06/07/08/14), session-lifetime configuration (10/11/15) land
 * with their owning IMP packages. Mapped here:
 *   TEST-AUTH-02  login (success + invalid-password rejection)
 *   TEST-AUTH-03  logout (session revoked — refresh denied after logout)
 *   TEST-AUTH-09  session refresh/rotation (identity preserved)
 * Supporting evidence: JWT subject == stable registry UUID; authenticated
 * request reaches Supabase; unauthenticated/anon cannot impersonate a user.
 */
import { describe, expect, it } from 'vitest';

import {
  decodeJwt,
  getUser,
  logout,
  refreshSession,
  signIn,
  userEmail,
  userId,
} from '../helpers.mjs';

describe('TEST-AUTH-02 — login', () => {
  it('email/password sign-in succeeds for a deterministic harness user', async () => {
    const res = await signIn(userEmail('USER_A_PARTNER'));
    expect(res.ok, JSON.stringify(res.raw)).toBe(true);
    expect(res.token).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
  });

  it('invalid password is rejected', async () => {
    const res = await signIn(userEmail('USER_A_PARTNER'), 'definitely-wrong-password');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.token).toBeUndefined();
  });

  it('JWT subject matches the expected stable registry UUID', async () => {
    const res = await signIn(userEmail('USER_A_PARTNER'));
    const claims = decodeJwt(res.token);
    expect(claims.sub).toBe(userId('USER_A_PARTNER'));
    expect(claims.role).toBe('authenticated');
  });
});

describe('TEST-AUTH-09 — session refresh/rotation', () => {
  it('refresh-token flow issues a new access token', async () => {
    const first = await signIn(userEmail('USER_A_MANAGER'));
    const refreshed = await refreshSession(first.refreshToken);
    expect(refreshed.ok, JSON.stringify(refreshed.raw)).toBe(true);
    expect(refreshed.token).toBeTruthy();
  });

  it('refreshed identity remains the same user', async () => {
    const first = await signIn(userEmail('USER_A_MANAGER'));
    const refreshed = await refreshSession(first.refreshToken);
    expect(decodeJwt(refreshed.token).sub).toBe(userId('USER_A_MANAGER'));
  });
});

describe('authenticated vs unauthenticated requests', () => {
  it('an authenticated request reaches Supabase as the expected user', async () => {
    const res = await signIn(userEmail('USER_A_SENIOR'));
    const me = await getUser(res.token);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(userId('USER_A_SENIOR'));
  });

  it('no token cannot impersonate an authenticated user', async () => {
    const me = await getUser('');
    expect(me.status).toBeGreaterThanOrEqual(400);
  });

  it('a garbage token cannot impersonate an authenticated user', async () => {
    const me = await getUser('garbage.token.value');
    expect(me.status).toBeGreaterThanOrEqual(400);
  });
});

describe('TEST-AUTH-03 — logout (session revoked)', () => {
  it('logout succeeds and the session can no longer be refreshed', async () => {
    const res = await signIn(userEmail('USER_A_ARTICLE'));
    expect(res.ok).toBe(true);
    const out = await logout(res.token);
    expect(out.status).toBeLessThan(300);
    // Revocation guarantee: the refresh token is dead after logout.
    const refreshed = await refreshSession(res.refreshToken);
    expect(refreshed.ok).toBe(false);
  });
});
