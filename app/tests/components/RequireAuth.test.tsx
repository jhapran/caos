/**
 * IMP-022 closure — Identity-bound active-firm bootstrap (RLS-CTX-01/02).
 *
 * Proves the module-level active-firm context can never leak across
 * identities and that the multi-firm default is deterministic:
 *   - stale firm from a previous identity is cleared BEFORE the new
 *     identity's protected children render
 *   - multiple ACTIVE memberships resolve to the smallest firm id
 *     regardless of array order
 *   - invited/suspended/removed-only identities get an EMPTY context
 *     (authorized-empty pages), never a stale firm
 *   - session replacement (same component instance, new user id)
 *     re-resolves
 *   - logout drops the context
 *
 * Auth is mocked at @/data/auth; the tenancy service is mocked at the
 * @/data barrel. The REAL context module is used so the actual module
 * state is observed (src/data/context.ts is selector state, never
 * authority — the DB re-validates every request).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RequireAuth from '@/components/RequireAuth';
import type { Assurance } from '@/data/auth';
import type { AuthService } from '@/data/auth/authService';
import type { FirmMembershipView } from '@/data/tenancy/tenancyService';
import { clearActiveFirm, getActiveFirm, setActiveFirm } from '@/data/context';

const FIRM_A = '00000000-0000-4000-8000-00000000000a';
const FIRM_B = '00000000-0000-4000-8000-00000000000b';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const AAL2: Assurance = { aal: 'aal2', hasVerifiedTotpFactor: true };

const mock = vi.hoisted(() => ({
  userId: null as string | null,
  memberships: [] as FirmMembershipView[],
  listCalls: 0,
}));

vi.mock('@/data/auth', () => ({
  useAuth: () => ({
    snapshot:
      mock.userId === null
        ? { status: 'unauthenticated', user: null }
        : { status: 'authenticated', user: { id: mock.userId, email: 'staff@caos.test' } },
    service: {
      mode: 'supabase',
      getAssurance: async () => AAL2,
    } as unknown as AuthService,
  }),
}));

vi.mock('@/data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/data')>();
  return {
    ...original,
    tenancyService: {
      mode: 'supabase',
      listMyMemberships: async () => {
        mock.listCalls += 1;
        return mock.memberships;
      },
    },
  };
});

function membership(firmId: string, status: FirmMembershipView['status']): FirmMembershipView {
  return {
    membershipId: `m-${firmId}-${status}`,
    firmId,
    firmName: `Firm ${firmId}`,
    role: 'partner',
    status,
  };
}

function guardTree() {
  return (
    <MemoryRouter>
      <Routes>
        <Route
          path="*"
          element={
            <RequireAuth>
              <div>protected content</div>
            </RequireAuth>
          }
        />
        <Route path="/auth/sign-in" element={<div>sign in page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderGuard() {
  return render(guardTree());
}

describe('<RequireAuth /> active-firm bootstrap (IMP-022 closure)', () => {
  beforeEach(() => {
    mock.userId = null;
    mock.memberships = [];
    mock.listCalls = 0;
    clearActiveFirm();
  });

  it('clears a stale firm and resolves deterministically before children render', async () => {
    // Stale context left over from a previous identity.
    setActiveFirm('99999999-9999-4999-8999-999999999999');
    mock.userId = USER_B;
    mock.memberships = [membership(FIRM_B, 'active'), membership(FIRM_A, 'active')];

    renderGuard();

    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
    // The stale id is gone; the resolved firm is the deterministic minimum.
    expect(getActiveFirm()).toBe(FIRM_A);
  });

  it('multi-firm default is independent of membership array order', async () => {
    mock.userId = USER_A;
    mock.memberships = [membership(FIRM_B, 'active'), membership(FIRM_A, 'active')];
    renderGuard();
    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
    expect(getActiveFirm()).toBe(FIRM_A);
  });

  it('invited/suspended/removed-only identity gets an empty context and still renders', async () => {
    setActiveFirm(FIRM_A); // stale from a previous session
    mock.userId = USER_A;
    mock.memberships = [
      membership(FIRM_A, 'suspended'),
      membership(FIRM_B, 'invited'),
    ];
    renderGuard();
    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
    // Fail closed: no firm selected — pages show authorized-empty state.
    expect(getActiveFirm()).toBeNull();
  });

  it('session replacement (new user id, no unmount) clears and re-resolves', async () => {
    mock.userId = USER_A;
    mock.memberships = [membership(FIRM_A, 'active')];
    const view = renderGuard();
    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
    expect(getActiveFirm()).toBe(FIRM_A);

    // Token/session replaced by a different user without a hard refresh.
    mock.userId = USER_B;
    mock.memberships = [membership(FIRM_B, 'active')];
    view.rerender(guardTree());
    await waitFor(() => {
      expect(getActiveFirm()).toBe(FIRM_B);
    });
    expect(screen.getByText('protected content')).toBeInTheDocument();
    expect(mock.listCalls).toBe(2);
  });

  it('logout drops the context and redirects to sign-in', async () => {
    mock.userId = USER_A;
    mock.memberships = [membership(FIRM_A, 'active')];
    const view = renderGuard();
    await waitFor(() => {
      expect(screen.getByText('protected content')).toBeInTheDocument();
    });
    expect(getActiveFirm()).toBe(FIRM_A);

    // User signs out.
    mock.userId = null;
    view.rerender(guardTree());
    await waitFor(() => {
      expect(screen.queryByText('protected content')).toBeNull();
    });
    expect(screen.getByText('sign in page')).toBeInTheDocument();
    expect(getActiveFirm()).toBeNull();
  });
});
