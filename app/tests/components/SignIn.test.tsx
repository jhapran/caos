/**
 * IMP-011 — Staff sign-in page (AUTH-02/04): form rendering and the
 * invalid-credential error path. The service is mocked at the @/data/auth
 * boundary — UI never touches Supabase directly.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SignIn from '@/pages/auth/SignIn';
import type { AuthService } from '@/data/auth/authService';

const mock = vi.hoisted(() => ({ service: null as unknown as AuthService }));

vi.mock('@/data/auth', () => ({
  useAuth: () => ({ snapshot: { status: 'unauthenticated', user: null }, service: mock.service }),
}));

function makeService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    mode: 'supabase',
    restore: async () => ({ status: 'unauthenticated', user: null }),
    onChange: () => () => {},
    signInPassword: async () => ({ ok: true }),
    signInMagicLink: async () => ({ ok: true }),
    requestPasswordReset: async () => ({ ok: true }),
    updatePassword: async () => ({ ok: true }),
    getAssurance: async () => ({ aal: 'aal1', hasVerifiedTotpFactor: false }),
    mfaEnrollTotp: async () => ({ ok: true }),
    mfaVerify: async () => ({ ok: true }),
    mfaChallengeVerifiedFactor: async () => ({ ok: true }),
    signOut: async () => {},
    ...overrides,
  };
}

function renderSignIn() {
  return render(
    <MemoryRouter>
      <SignIn />
    </MemoryRouter>,
  );
}

describe('<SignIn /> (IMP-011)', () => {
  beforeEach(() => {
    mock.service = makeService();
  });

  it('renders email/password sign-in with magic-link and recovery entries', () => {
    renderSignIn();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /magic link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/auth/forgot-password',
    );
    // Invitation-only: no self-service sign-up surface (AUTH-03).
    expect(screen.queryByRole('link', { name: /sign up|register|create account/i })).toBeNull();
  });

  it('shows the service error on invalid credentials (AUTH-02 rejection path)', async () => {
    mock.service = makeService({
      signInPassword: async () => ({ ok: false, error: 'Invalid login credentials' }),
    });
    renderSignIn();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'staff@caos.test');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeInTheDocument();
    });
  });

  it('magic-link request shows a neutral, non-enumerating notice (AUTH-04)', async () => {
    mock.service = makeService({ signInMagicLink: async () => ({ ok: true }) });
    renderSignIn();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'staff@caos.test');
    await user.click(screen.getByRole('button', { name: /magic link/i }));
    await waitFor(() => {
      expect(screen.getByText(/if this email is registered/i)).toBeInTheDocument();
    });
  });
});
