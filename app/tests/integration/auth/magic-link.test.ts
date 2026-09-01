/**
 * IMP-011 — Magic-link sign-in (TEST-AUTH-05) against LOCAL GoTrue +
 * Mailpit. Full request path: OTP request -> email captured locally ->
 * token verified -> session. Also asserts the invitation-only surface
 * (AUTH-03): public sign-up is disabled.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  adminCreateUser,
  adminDeleteUser,
  authPost,
  decodeJwt,
  mailpitVerifyLink,
} from '../helpers.mjs';

const EMAIL = 'imp011.magiclink@caos.test';
const PASSWORD = 'Imp011!LocalOnly';

let userId;

describe('TEST-AUTH-05 — magic link', () => {
  afterAll(async () => {
    if (userId) await adminDeleteUser(userId);
  });

  it('magic-link request is accepted for an existing user', async () => {
    const user = await adminCreateUser(EMAIL, PASSWORD, { imp011: 'magic-link' });
    userId = user.id;
    const res = await authPost('otp', { email: EMAIL, create_user: false });
    expect(res.status).toBe(200);
  });

  it('the emailed link produces a full session for the same identity', async () => {
    const { tokenHash, type } = await mailpitVerifyLink(EMAIL);
    expect(type).toBe('magiclink');
    const verified = await authPost('verify', { type: 'magiclink', token_hash: tokenHash });
    expect(verified.status).toBe(200);
    expect(verified.body.access_token).toBeTruthy();
    expect(decodeJwt(verified.body.access_token).sub).toBe(userId);
  });

  it('single-use: the same token cannot be replayed', async () => {
    const { tokenHash } = await mailpitVerifyLink(EMAIL);
    const replay = await authPost('verify', { type: 'magiclink', token_hash: tokenHash });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });

  it('AUTH-03: public sign-up surface is disabled', async () => {
    const res = await authPost('signup', { email: 'imp011.selfsignup@caos.test', password: PASSWORD });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('AUTH-03: OTP with create_user does not register a new identity', async () => {
    const res = await authPost('otp', { email: 'imp011.ghost@caos.test', create_user: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
