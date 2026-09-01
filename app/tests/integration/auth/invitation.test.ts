/**
 * IMP-011 — Invitation-only onboarding mechanism (TEST-AUTH-01, AUTH-03)
 * and token-content security assertions.
 *
 * Mechanism level: the admin/invite path creates (or reuses) the identity
 * and a FirmMembership in `invited` state; first use sets a password and
 * acceptance transitions the membership to `active`. IMP-013 landed the
 * production acceptance path: the `accept_invitation` Layer-B RPC (the
 * invitee flips their OWN invited row; the write policies/grants for raw
 * membership administration no longer exist).
 *
 * Security: the access token must carry identity claims only — never
 * firm/role/membership authority (DEC-J, AUTH-00).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminGenerateLink,
  api,
  authPost,
  authPutUser,
  decodeJwt,
  deleteUserByEmail,
  FIRM_A,
  psql,
  signIn,
} from '../helpers.mjs';

const EMAIL = 'imp011.invite@caos.test';
const FIRST_PASSWORD = 'Imp011!InvitedLocalOnly';

let userId;

function cleanupRows() {
  psql(`delete from public.firm_memberships where firm_id = '${FIRM_A}';
        delete from public.firms where id = '${FIRM_A}';
        delete from public.audit_log where firm_id = '${FIRM_A}';
        delete from public.audit_log where object_id = '${userId ?? ''}'`);
}

describe('TEST-AUTH-01 — invitation mechanism', () => {
  beforeAll(async () => {
    // Idempotent setup: a previously failed run may have left residue.
    // Membership rows MUST go first — firm_memberships_user_fkey blocks
    // auth-user deletion while a membership still references the user.
    cleanupRows();
    await deleteUserByEmail(EMAIL);
  });

  afterAll(async () => {
    cleanupRows();
    await deleteUserByEmail(EMAIL);
  });

  it('invite path creates identity + invited membership (no implicit access)', async () => {
    psql(`insert into public.firms (id, name) values ('${FIRM_A}', 'IMP-011 Invite Test Firm')
          on conflict (id) do nothing`);
    const link = await adminGenerateLink('invite', EMAIL);
    userId = link.id ?? link.user?.id ?? (link.user ?? link).id;
    expect(userId).toBeTruthy();
    psql(`insert into public.firm_memberships (firm_id, user_id, role, status)
          values ('${FIRM_A}', '${userId}', 'senior', 'invited')`);
    const status = psql(
      `select status from public.firm_memberships where firm_id = '${FIRM_A}' and user_id = '${userId}'`,
    ).trim();
    expect(status).toBe('invited');
  });

  it('invitee verifies the link and sets a password on first use', async () => {
    const link = await adminGenerateLink('invite', EMAIL);
    const verified = await authPost('verify', { type: 'invite', token_hash: link.hashed_token });
    expect(verified.status).toBe(200);
    const updated = await authPutUser(verified.body.access_token, { password: FIRST_PASSWORD });
    expect(updated.status).toBe(200);
  });

  it('acceptance transitions membership to active via the production RPC; sign-in then works', async () => {
    // IMP-013 production path: the invitee self-accepts their own invited
    // membership through the accept_invitation Layer-B RPC (no AAL2 —
    // acceptance precedes MFA enrolment, AUTH-10 ordering).
    const session = await signIn(EMAIL, FIRST_PASSWORD);
    expect(session.ok).toBe(true);
    const accepted = await api(session.token, 'POST', 'rpc/accept_invitation', {
      body: { p_firm_id: FIRM_A },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('active');
    const status = psql(
      `select status from public.firm_memberships where firm_id = '${FIRM_A}' and user_id = '${userId}'`,
    ).trim();
    expect(status).toBe('active');
  });

  it('access token carries identity claims only — no firm/role authority', async () => {
    const session = await signIn(EMAIL, FIRST_PASSWORD);
    const payload = decodeJwt(session.token);
    // NOTE: `role: "authenticated"` is the GoTrue/PostgREST *database role*
    // claim — expected and NOT application authority. Application-level
    // firm/membership/role authority claims must never appear (DEC-J).
    expect(payload.role).toBe('authenticated');
    const forbidden = ['firm_id', 'firm', 'membership', 'membership_id', 'tenant', 'app_role', 'user_role'];
    for (const key of forbidden) {
      expect(payload).not.toHaveProperty(key);
      expect(payload.app_metadata ?? {}).not.toHaveProperty(key);
      expect(payload.user_metadata ?? {}).not.toHaveProperty(key);
    }
    expect(payload.sub).toBe(userId);
    expect(payload.aal).toBeTruthy();
  });
});
