/**
 * IMP-011 — Session policy verification (TEST-AUTH-09 rotation,
 * TEST-AUTH-10/11 session targets, TEST-AUTH-15 platform values recorded,
 * AUTH-08).
 *
 * AUTH-08 targets are verified against actual platform behaviour/config —
 * never assumed:
 *   - access-token lifetime: measured from the issued JWT (exp - iat);
 *   - rotating refresh tokens: v1 legacy-token semantics (GoTrue v2.196)
 *     — revoked parent-of-active replay is tolerated (fail-to-save);
 *     an older revoked token replayed > 10 s after revocation is detected
 *     (400 "Already Used", token family revoked; the session and its
 *     access token survive until their own expiry);
 *   - timebox (7 d) and inactivity timeout (12 h): asserted from the
 *     committed GoTrue config (supabase/config.toml) and recorded in
 *     docs/spec/13-operations-observability.md.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decodeJwt, getUser, refreshSession, signIn, userEmail } from '../helpers.mjs';

describe('TEST-AUTH-09 — refresh rotation (reuse detection)', () => {
  // Verified against GoTrue v2.196.0 source (internal/tokens/service.go,
  // v1 legacy-token path — the local stack issues v1 12-char tokens):
  //  - rotation: each refresh revokes the old row and issues a new token;
  //  - replaying the revoked PARENT of the currently active token is
  //    tolerated indefinitely (client fail-to-save recovery) and returns
  //    the active token;
  //  - replaying an older revoked token > refresh_token_reuse_interval
  //    (10 s) after its revocation is DETECTED: 400 "Already Used" and
  //    the whole token family is revoked;
  //  - v1 detection revokes the token FAMILY but does NOT destroy the
  //    session: the issued access token remains valid until its expiry.
  it(
    'rotation, fail-to-save tolerance, and hard reuse detection',
    { timeout: 45_000 },
    async () => {
      const session = await signIn(userEmail('USER_A_SENIOR'));
      expect(session.ok).toBe(true);

      // 1. Rotation: refreshing issues a NEW refresh token.
      const r1 = await refreshSession(session.refreshToken);
      expect(r1.ok).toBe(true);
      expect(r1.refreshToken).toBeTruthy();
      expect(r1.refreshToken).not.toBe(session.refreshToken);

      // 2. Fail-to-save tolerance: replaying the revoked parent of the
      //    active token succeeds and returns the active token.
      const parentReplay = await refreshSession(session.refreshToken);
      expect(parentReplay.status).toBe(200);

      // 3. Advance the family again, then leave the reuse interval.
      const r2 = await refreshSession(r1.refreshToken);
      expect(r2.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 11_000));

      // 4. Hard reuse detection: the original token is two generations
      //    old and outside the interval -> 400 "Already Used", family revoked.
      const detected = await refreshSession(session.refreshToken);
      expect(detected.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(detected.raw)).toMatch(/Already Used/i);

      // 5. The family STAYS revoked: after the post-detection window the
      //    newest family token is also rejected.
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      const stillDead = await refreshSession(r2.refreshToken);
      expect(stillDead.status).toBeGreaterThanOrEqual(400);

      // 6. v1 semantics: detection revokes the token family but not the
      //    session — the access token remains valid until its own expiry.
      const user = await getUser(r2.token);
      expect(user.status).toBe(200);
    },
  );
});

describe('TEST-AUTH-15 — platform session values (measured, not assumed)', () => {
  it('access-token lifetime is approximately 1 hour', async () => {
    const session = await signIn(userEmail('USER_A_SENIOR'));
    const payload = decodeJwt(session.token);
    expect(payload.exp - payload.iat).toBe(3600);
  });
});

describe('TEST-AUTH-10/11 — session targets in committed config', () => {
  it('timebox (7 d) and inactivity timeout (12 h) are configured', () => {
    const config = readFileSync('supabase/config.toml', 'utf8');
    expect(config).toMatch(/timebox\s*=\s*"168h"/);
    expect(config).toMatch(/inactivity_timeout\s*=\s*"12h"/);
    expect(config).toMatch(/jwt_expiry\s*=\s*3600/);
    expect(config).toMatch(/enable_refresh_token_rotation\s*=\s*true/);
  });
});
