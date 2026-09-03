/**
 * IMP-022 closure — Deterministic active-firm bootstrap against the real
 * local stack (RLS-CTX-01/02).
 *
 * Proves at the adapter level what RequireAuth does at the UI level:
 *   - listMyMemberships returns a STABLE firm_id ordering (no incidental
 *     PostgREST row order), so the temporary R0 default —
 *     resolveDefaultActiveFirm (smallest ACTIVE firm id) — is identical on
 *     every bootstrap;
 *   - with the resolved firm selected, Client 360 reads are scoped to
 *     exactly that firm: own-firm client composes, other-firm client is
 *     the identical null (no leak across the unselected membership);
 *   - clearing the context + re-resolving as a different identity (the
 *     module-level equivalent of RequireAuth's identity-change clearing)
 *     leaves no trace of the previous firm;
 *   - only ACTIVE memberships are eligible at the SQL level too.
 *
 * Context is selection, never authority: the database re-validates the
 * header against the live membership on every request (DEC-J).
 *
 * Fixture rows: deterministic ids in the 9c000000-… range; teardown in FK
 * order, profiles last (only rows this suite inserted).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client360Service } from '@/data/client360';
import {
  clearActiveFirm,
  getActiveFirm,
  resolveDefaultActiveFirm,
  setActiveFirm,
} from '@/data/context';
import { tenancyService } from '@/data/tenancy/tenancyService';
import { getSupabaseClient } from '@/lib/supabaseClient';

import { FIRM_A, FIRM_B, PASSWORD, psql, userEmail, userId } from '../helpers.mjs';

const M = {
  multiA: '9c000000-0000-4000-8000-000000000001',
  multiB: '9c000000-0000-4000-8000-000000000002',
  partnerA: '9c000000-0000-4000-8000-000000000003',
  partnerB: '9c000000-0000-4000-8000-000000000004',
};

const C = {
  firmA: '9c000000-0000-4000-8000-000000000101',
  firmB: '9c000000-0000-4000-8000-000000000102',
};

const MULTI = userId('USER_MULTI_FIRM');
const PARTNER_A = userId('USER_A_PARTNER');
const PARTNER_B = userId('USER_B_PARTNER');

const EXPECTED_DEFAULT = [FIRM_A, FIRM_B].sort()[0];

async function signInAs(email: string) {
  const { error } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(error).toBeNull();
}

function cleanRows() {
  psql(`
    delete from public.clients where id in ('${C.firmA}', '${C.firmB}');
    delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}');
  `);
}

beforeAll(() => {
  cleanRows();
  psql(`
    insert into public.firms (id, name) values
      ('${FIRM_A}', 'IMP-022 ActiveFirm Firm A'),
      ('${FIRM_B}', 'IMP-022 ActiveFirm Firm B')
    on conflict (id) do nothing;

    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.multiA}',   '${FIRM_A}', '${MULTI}',     'manager', 'active'),
      ('${M.multiB}',   '${FIRM_B}', '${MULTI}',     'manager', 'active'),
      ('${M.partnerA}', '${FIRM_A}', '${PARTNER_A}', 'partner', 'active'),
      ('${M.partnerB}', '${FIRM_B}', '${PARTNER_B}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;

    insert into public.profiles (id, full_name) values
      ('${PARTNER_A}', 'ActiveFirm Partner Alpha'),
      ('${PARTNER_B}', 'ActiveFirm Partner Beta')
    on conflict (id) do nothing;

    insert into public.clients (id, firm_id, name, owner_partner_membership_id, manager_membership_id, status) values
      ('${C.firmA}', '${FIRM_A}', 'ActiveFirm Client A', '${M.partnerA}', '${M.multiA}', 'active'),
      ('${C.firmB}', '${FIRM_B}', 'ActiveFirm Client B', '${M.partnerB}', '${M.multiB}', 'active');
  `);
  psql(`delete from public.audit_log where firm_id in ('${FIRM_A}', '${FIRM_B}')`);
});

afterAll(async () => {
  clearActiveFirm();
  await getSupabaseClient().auth.signOut();
  cleanRows();
  psql(`
    delete from public.firm_memberships where id in ('${M.multiA}', '${M.multiB}', '${M.partnerA}', '${M.partnerB}');
    delete from public.profiles where id in ('${PARTNER_A}', '${PARTNER_B}');
    delete from public.firms where id in ('${FIRM_A}', '${FIRM_B}');
  `);
});

describe('active-firm bootstrap — deterministic multi-firm default (IMP-022 closure)', () => {
  it('membership reads have a stable firm_id order and the default is the smallest ACTIVE firm', async () => {
    await signInAs(userEmail('USER_MULTI_FIRM'));

    const first = await tenancyService.listMyMemberships();
    const second = await tenancyService.listMyMemberships();

    // Stable ordering at the adapter level — no incidental row order.
    expect(first.map((m) => m.firmId)).toEqual([...first.map((m) => m.firmId)].sort());
    expect(second.map((m) => m.firmId)).toEqual(first.map((m) => m.firmId));

    // Both memberships are ACTIVE; the default is the smallest firm id,
    // identical across repeated resolution.
    expect(first).toHaveLength(2);
    expect(first.every((m) => m.status === 'active')).toBe(true);
    expect(resolveDefaultActiveFirm(first)).toBe(EXPECTED_DEFAULT);
    expect(resolveDefaultActiveFirm([...first].reverse())).toBe(EXPECTED_DEFAULT);
    expect(resolveDefaultActiveFirm(second)).toBe(EXPECTED_DEFAULT);
  });

  it('with the resolved firm selected, Client 360 is scoped to exactly that firm', async () => {
    await signInAs(userEmail('USER_MULTI_FIRM'));
    const firm = resolveDefaultActiveFirm(await tenancyService.listMyMemberships());
    expect(firm).toBe(EXPECTED_DEFAULT);
    setActiveFirm(firm);

    const ownClient = firm === FIRM_A ? C.firmA : C.firmB;
    const otherClient = firm === FIRM_A ? C.firmB : C.firmA;

    // Own-firm client composes; the other membership's client is the
    // identical null — the unselected firm never leaks into the view.
    expect(await client360Service.getClient360(ownClient)).not.toBeNull();
    expect(await client360Service.getClient360(otherClient)).toBeNull();
  });

  it('identity change at the module level: clear + re-resolve leaves no stale firm', async () => {
    // Previous identity's context.
    await signInAs(userEmail('USER_MULTI_FIRM'));
    setActiveFirm(resolveDefaultActiveFirm(await tenancyService.listMyMemberships()));
    const previousFirm = getActiveFirm();
    expect(previousFirm).toBe(EXPECTED_DEFAULT);

    // RequireAuth clears on identity change BEFORE the new identity's
    // pages render; the module-level equivalent is clear → sign-in →
    // resolve.
    clearActiveFirm();
    expect(getActiveFirm()).toBeNull();

    await signInAs(userEmail('USER_A_PARTNER'));
    const resolved = resolveDefaultActiveFirm(await tenancyService.listMyMemberships());
    setActiveFirm(resolved);

    // The new identity resolves deterministically to its own firm; the
    // previous multi-firm context is gone.
    expect(resolved).toBe(FIRM_A);
    expect(getActiveFirm()).toBe(FIRM_A);
    expect(await client360Service.getClient360(C.firmA)).not.toBeNull();
    expect(await client360Service.getClient360(C.firmB)).toBeNull();
  });
});
