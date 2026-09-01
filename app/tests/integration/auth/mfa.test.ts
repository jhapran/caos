/**
 * IMP-011 — TOTP MFA (TEST-AUTH-06 enrolment, TEST-AUTH-07 challenge,
 * TEST-AUTH-08 AAL distinction at stub level) and device-loss recovery
 * mechanism (TEST-AUTH-14, AUTH-11).
 *
 * AAL2 *enforcement* of sensitive operations is IMP-012 (RLS-AAL-01) —
 * here we prove the assurance mechanics: enrol, challenge, aal1 -> aal2,
 * failed verification, and admin-assisted factor revocation before
 * re-enrolment. The recovery audit row lands with IMP-013 (AUD-MFA-01).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminCreateUser,
  adminDeleteFactor,
  adminDeleteUser,
  adminListFactors,
  authPost,
  decodeJwt,
  deleteUserByEmail,
  signIn,
  totpCode,
} from '../helpers.mjs';

const EMAIL = 'imp011.mfa@caos.test';
const PASSWORD = 'Imp011!LocalOnly';

let userId;
let factorId;
let secret;
let token;

async function enroll() {
  const res = await authPost('factors', { factor_type: 'totp', friendly_name: 'imp011-test' }, token);
  expect(res.status).toBe(200);
  return res.body;
}

async function challengeAndVerify(fId, code) {
  const challenge = await authPost(`factors/${fId}/challenge`, {}, token);
  expect(challenge.status).toBe(200);
  return authPost(`factors/${fId}/verify`, { challenge_id: challenge.body.id, code }, token);
}

// NOTE: user deletion happens once at file level, AFTER the device-loss
// describe — deleting it in this block's afterAll would run before the
// device-loss test and cause user_not_found there.
beforeAll(async () => {
  await deleteUserByEmail(EMAIL); // idempotent: tolerate previously failed runs
});

afterAll(async () => {
  if (userId) await adminDeleteUser(userId);
});

describe('TEST-AUTH-06/07/08 — TOTP enrolment, challenge, AAL', () => {

  it('password session starts at AAL1', async () => {
    const user = await adminCreateUser(EMAIL, PASSWORD, { imp011: 'mfa' });
    userId = user.id;
    const session = await signIn(EMAIL, PASSWORD);
    expect(session.ok).toBe(true);
    token = session.token;
    expect(decodeJwt(token).aal).toBe('aal1');
  });

  it('TOTP enrolment returns a secret and an unverified factor', async () => {
    const body = await enroll();
    factorId = body.id;
    secret = body.totp.secret;
    expect(factorId).toBeTruthy();
    expect(secret).toBeTruthy();
  });

  it('failed verification is rejected', async () => {
    const actual = totpCode(secret);
    const wrong = actual === '000000' ? '111111' : '000000';
    const res = await challengeAndVerify(factorId, wrong);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('correct code verifies the factor and upgrades the session to AAL2', async () => {
    const res = await challengeAndVerify(factorId, totpCode(secret));
    expect(res.status).toBe(200);
    const newToken = res.body.access_token ?? token;
    expect(decodeJwt(newToken).aal).toBe('aal2');
  });
});

describe('TEST-AUTH-14 — MFA device-loss recovery mechanism (AUTH-11)', () => {
  it('admin revokes the lost factor; re-enrolment then succeeds', async () => {
    const factors = await adminListFactors(userId);
    const totp = factors.find((f) => f.factor_type === 'totp' || f.type === 'totp');
    expect(totp).toBeTruthy();
    await adminDeleteFactor(userId, totp.id);
    const after = await adminListFactors(userId);
    expect(after.filter((f) => (f.factor_type ?? f.type) === 'totp')).toHaveLength(0);

    // Re-enrolment permitted only after the old factor was revoked.
    const session = await signIn(EMAIL, PASSWORD);
    expect(session.ok).toBe(true);
    token = session.token;
    const body = await enroll();
    const res = await challengeAndVerify(body.id, totpCode(body.totp.secret));
    expect(res.status).toBe(200);
  });
});
