/**
 * IMP-014 — Tenancy adapter contract against the real local stack.
 *
 * TEST-API-01…03 (contract conformance skeleton, spec 11) + API-ARCH-02/03:
 * the SAME tenancyService contract is served by the Supabase adapter via
 * plain PostgREST reads under RLS — no fixture modules, no RPC wrappers,
 * no existence oracles.
 *
 *   TEST-API-01 skeleton: collection reads never error on unauthorized
 *     rows — foreign rows are simply absent (API-ERR-02).
 *   TEST-API-02 skeleton: single-resource reads return the identical
 *     not_found shape (null) for nonexistent and inaccessible ids.
 *   TEST-API-03 skeleton: privileged denials translate to the
 *     'unauthorized' taxonomy kind without protected-existence detail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toApiError } from '@/data/errors';
import { tenancyService } from '@/data/tenancy/tenancyService';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { FIRM_A, FIRM_B, PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

const M = {
  partnerA: '90000000-0000-4000-8000-000000000002',
  seniorA: '90000000-0000-4000-8000-000000000004',
  partnerB: '90000000-0000-4000-8000-00000000000a',
  multiA: '90000000-0000-4000-8000-00000000000b',
  multiB: '90000000-0000-4000-8000-00000000000c',
};

const PROFILE_USERS = ['USER_A_PARTNER', 'USER_A_SENIOR', 'USER_B_PARTNER'];

async function signInAs(email: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password: PASSWORD });
  expect(error).toBeNull();
}

beforeAll(() => {
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-014 Tenancy Firm A'),
      ('${FIRM_B}', 'IMP-014 Tenancy Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.partnerA}', '${FIRM_A}', '${userId('USER_A_PARTNER')}', 'partner', 'active'),
      ('${M.seniorA}',  '${FIRM_A}', '${userId('USER_A_SENIOR')}',  'senior',  'active'),
      ('${M.partnerB}', '${FIRM_B}', '${userId('USER_B_PARTNER')}', 'partner', 'active'),
      ('${M.multiA}',   '${FIRM_A}', '${userId('USER_MULTI_FIRM')}', 'manager', 'active'),
      ('${M.multiB}',   '${FIRM_B}', '${userId('USER_MULTI_FIRM')}', 'senior',  'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.profiles (id, full_name, avatar_url) values
      ('${userId('USER_A_PARTNER')}', 'Partner A', null),
      ('${userId('USER_A_SENIOR')}',  'Senior A',  null),
      ('${userId('USER_B_PARTNER')}', 'Partner B', null)
    on conflict (id) do nothing;

    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

afterAll(async () => {
  await getSupabaseClient().auth.signOut();
  psql(`
    delete from public.firm_memberships where firm_id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.profiles where id in (${PROFILE_USERS.map((k) => `'${userId(k)}'`).join(',')});
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('tenancyService — supabase adapter (TEST-API-01…03 skeleton)', () => {
  it('serves the shared contract in supabase mode (API-ARCH-02)', () => {
    expect(tenancyService.mode).toBe('supabase');
  });

  it('TEST-API-01: own memberships only — foreign rows absent, never an error', async () => {
    await signInAs(userEmail('USER_A_SENIOR'));
    const memberships = await tenancyService.listMyMemberships();
    expect(memberships).toEqual([
      {
        membershipId: M.seniorA,
        firmId: FIRM_A,
        firmName: 'IMP-014 Tenancy Firm A',
        role: 'senior',
        status: 'active',
      },
    ]);
  });

  it('TEST-API-01: a multi-firm user sees exactly its own two memberships', async () => {
    await signInAs(userEmail('USER_MULTI_FIRM'));
    const memberships = await tenancyService.listMyMemberships();
    expect(memberships.map((m) => m.firmId).sort()).toEqual([FIRM_A, FIRM_B].sort());
    expect(memberships.every((m) => m.status === 'active')).toBe(true);
  });

  it('TEST-API-02: own and shared-firm profiles are readable', async () => {
    await signInAs(userEmail('USER_A_SENIOR'));
    expect(await tenancyService.getMyProfile()).toEqual({
      id: userId('USER_A_SENIOR'),
      fullName: 'Senior A',
      avatarUrl: null,
    });
    expect(await tenancyService.getProfile(userId('USER_A_PARTNER'))).toEqual({
      id: userId('USER_A_PARTNER'),
      fullName: 'Partner A',
      avatarUrl: null,
    });
  });

  it('TEST-API-02: inaccessible and nonexistent profiles return the identical null shape', async () => {
    await signInAs(userEmail('USER_A_SENIOR'));
    const inaccessible = await tenancyService.getProfile(userId('USER_B_PARTNER'));
    const nonexistent = await tenancyService.getProfile('00000000-0000-4000-8000-000000000099');
    expect(inaccessible).toBeNull();
    expect(nonexistent).toBeNull();
  });

  it('TEST-API-01/02: unauthenticated reads degrade to empty/null, never errors', async () => {
    await getSupabaseClient().auth.signOut();
    expect(await tenancyService.listMyMemberships()).toEqual([]);
    expect(await tenancyService.getMyProfile()).toBeNull();
  });

  it("TEST-API-03: a privileged denial translates to the 'unauthorized' kind", async () => {
    await signInAs(userEmail('USER_A_SENIOR'));
    const { error } = await getSupabaseClient().rpc('invite_member', {
      p_firm_id: FIRM_A,
      p_user_id: userId('USER_B_PARTNER'),
      p_role: 'senior',
    });
    expect(error).not.toBeNull();
    // PostgREST surfaces the denial as HTTP 403 / PG 42501; the taxonomy
    // kind must be exactly 'unauthorized' — the denial surfaces (API-ERR-03)
    // without revealing any protected-existence detail.
    const apiError = toApiError(error);
    expect(apiError.kind).toBe('unauthorized');
  });
});
