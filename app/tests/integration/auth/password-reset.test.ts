/**
 * IMP-011 — Password recovery (TEST-AUTH-04, AUTH-06) against LOCAL
 * GoTrue + Mailpit: recovery request -> emailed link -> recovery session
 * -> password update -> old password rejected, new password works.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  adminCreateUser,
  adminDeleteUser,
  authPost,
  authPutUser,
  mailpitVerifyLink,
  signIn,
} from '../helpers.mjs';

const EMAIL = 'imp011.recovery@caos.test';
const OLD_PASSWORD = 'Imp011!OldLocalOnly';
const NEW_PASSWORD = 'Imp011!NewLocalOnly';

let userId;

describe('TEST-AUTH-04 — password reset', () => {
  afterAll(async () => {
    if (userId) await adminDeleteUser(userId);
  });

  it('recovery request is accepted', async () => {
    const user = await adminCreateUser(EMAIL, OLD_PASSWORD, { imp011: 'recovery' });
    userId = user.id;
    const res = await authPost('recover', { email: EMAIL });
    expect(res.status).toBe(200);
  });

  it('recovery link yields a session that can set a new password', async () => {
    const { tokenHash, type } = await mailpitVerifyLink(EMAIL);
    expect(type).toBe('recovery');
    const verified = await authPost('verify', { type: 'recovery', token_hash: tokenHash });
    expect(verified.status).toBe(200);
    const updated = await authPutUser(verified.body.access_token, { password: NEW_PASSWORD });
    expect(updated.status).toBe(200);
  });

  it('old password no longer works; new password works', async () => {
    const oldAttempt = await signIn(EMAIL, OLD_PASSWORD);
    expect(oldAttempt.ok).toBe(false);
    const newAttempt = await signIn(EMAIL, NEW_PASSWORD);
    expect(newAttempt.ok).toBe(true);
    expect(newAttempt.token).toBeTruthy();
  });
});
