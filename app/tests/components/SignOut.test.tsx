/**
 * Sign-out closure — the authenticated shell exposes the ONE existing
 * auth facade signOut (AUTH-05); no second logout implementation.
 *
 * Proves:
 *   - a Sign out action is visible for authenticated Supabase staff in the
 *     sidebar user area, and absent in fixture mode (no real session)
 *   - clicking it calls the existing service.signOut exactly once and
 *     lands on /auth/sign-in
 *   - after sign-out the active-firm context is cleared (real context
 *     module observed) and the protected route no longer renders
 *
 * Auth is mocked at @/data/auth; tenancy at the @/data barrel; the REAL
 * src/data/context.ts module is used so active-firm clearing is observed
 * for real (RequireAuth owns the clear-on-unauthenticated effect).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Navbar from '@/components/Navbar';
import RequireAuth from '@/components/RequireAuth';
import { DemoStoreProvider } from '@/data/store';
import { clearActiveFirm, getActiveFirm } from '@/data/context';
import type { AuthService } from '@/data/auth/authService';
import type { FirmMembershipView } from '@/data/tenancy/tenancyService';

const FIRM_A = '00000000-0000-4000-8000-00000000000a';

const mock = vi.hoisted(() => ({
  mode: 'supabase' as 'fixture' | 'supabase',
  userId: 'u-1' as string | null,
  signOutCalls: 0,
  rerender: () => {},
}));

vi.mock('@/data/auth', () => ({
  useAuth: () => ({
    snapshot:
      mock.userId === null
        ? { status: 'unauthenticated', user: null }
        : { status: 'authenticated', user: { id: mock.userId, email: 'stg@caos-staging.test' } },
    service: {
      mode: mock.mode,
      getAssurance: async () => ({ aal: 'aal2', hasVerifiedTotpFactor: true }),
      signOut: async () => {
        mock.signOutCalls += 1;
        mock.userId = null;
        mock.rerender();
      },
    } as unknown as AuthService,
  }),
}));

const MEMBERSHIP: FirmMembershipView = {
  membershipId: 'm-1',
  firmId: FIRM_A,
  firmName: 'Real Hosted Firm',
  role: 'partner',
  status: 'active',
};

vi.mock('@/data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/data')>();
  return {
    ...original,
    tenancyService: {
      mode: 'supabase',
      getMyProfile: async () => ({ id: 'u-1', fullName: 'Real Staff Member', avatarUrl: null }),
      listMyMemberships: async () => [MEMBERSHIP],
    },
  };
});

/** Harness that lets the mocked signOut trigger a React re-render. */
function Harness() {
  const [, force] = useState(0);
  // Wired in an effect, not during render (react-hooks/immutability):
  // the mocked signOut re-renders the tree after sign-out.
  useEffect(() => {
    mock.rerender = () => force((n) => n + 1);
    return () => {
      mock.rerender = () => {};
    };
  }, []);
  return (
    <MemoryRouter initialEntries={['/clients']}>
      <DemoStoreProvider>
        <Routes>
          <Route path="/auth/sign-in" element={<div>Sign in page</div>} />
          <Route
            path="/clients"
            element={
              <RequireAuth>
                <>
                  <Navbar mobileOpen={false} onCloseMobile={() => {}} />
                  <div>Protected content</div>
                </>
              </RequireAuth>
            }
          />
        </Routes>
      </DemoStoreProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mock.mode = 'supabase';
  mock.userId = 'u-1';
  mock.signOutCalls = 0;
  clearActiveFirm();
});

describe('Sign out (supabase mode)', () => {
  it('offers Sign out in the user menu, calls the existing facade, redirects, and clears active-firm context', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Protected page rendered; active firm resolved via RequireAuth.
    await screen.findByText('Protected content');
    await waitFor(() => expect(getActiveFirm()).toBe(FIRM_A));

    // Sign out action lives in the sidebar user menu.
    await user.click(await screen.findByRole('button', { name: /account menu/i }));
    const item = await screen.findByRole('menuitem', { name: /sign out/i });
    await user.click(item);

    await waitFor(() => expect(mock.signOutCalls).toBe(1));
    // Redirected to staff sign-in; protected content unmounted.
    await screen.findByText('Sign in page');
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    // Active-firm context cleared by the existing RequireAuth effect.
    await waitFor(() => expect(getActiveFirm()).toBeNull());
  });
});

describe('Sign out (fixture mode)', () => {
  it('offers no sign-out action — the demo track has no real session', async () => {
    mock.mode = 'fixture';
    render(<Harness />);
    await screen.findByText('Protected content');
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^sign out$/i })).not.toBeInTheDocument();
    // Fixture demo presentation untouched.
    expect(screen.getByText(/Seeded demo data/i)).toBeInTheDocument();
  });
});
