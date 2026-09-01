/**
 * IMP-011 — Revocation and disabled-user mechanisms (TEST-AUTH-12/13 at
 * the auth level, AUTH-12/13/14).
 *
 * AUTH-13/14: suspension/removal must trigger explicit session revocation
 * rather than waiting for token expiry. The membership-level loss of
 * access is enforced by the DEC-J live lookup (covered by the RLS harness
 * on hgate_* and by production policies in IMP-012); this suite proves
 * the revocation call path works: after revocation, the refresh token is
 * dead.
 *
 * AUTH-12: a disabled (banned) user cannot start a new session and cannot
 * refresh an existing one.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  adminCreateUser,
  adminDeleteUser,
  adminUpdateUser,
  authPost,
  refreshSession,
  signIn,
} from '../helpers.mjs';

const EMAIL = 'imp011.revoke@caos.test';
const PASSWORD = 'Imp011!LocalOnly';

let userId;

describe('TEST-AUTH-12/13 — revocation and disabled user', () => {
  afterAll(async () => {
    if (userId) {
      await adminUpdateUser(userId, { ban_duration: 'none' });
      await adminDeleteUser(userId);
    }
  });

  it('global logout revokes the refresh token (suspension call path)', async () => {
    const user = await adminCreateUser(EMAIL, PASSWORD, { imp011: 'revocation' });
    userId = user.id;
    const session = await signIn(EMAIL, PASSWORD);
    expect(session.ok).toBe(true);

    const revoked = await authPost('logout?scope=global', {}, session.token);
    expect(revoked.status).toBeLessThan(300);

    const refresh = await refreshSession(session.refreshToken);
    expect(refresh.status).toBeGreaterThanOrEqual(400);
  });

  it('AUTH-12: banned user cannot sign in or refresh', async () => {
    const session = await signIn(EMAIL, PASSWORD);
    expect(session.ok).toBe(true);

    const banned = await adminUpdateUser(userId, { ban_duration: '876000h' });
    expect(banned.ok).toBe(true);

    const attempt = await signIn(EMAIL, PASSWORD);
    expect(attempt.ok).toBe(false);
    const refresh = await refreshSession(session.refreshToken);
    expect(refresh.status).toBeGreaterThanOrEqual(400);
  });
});
