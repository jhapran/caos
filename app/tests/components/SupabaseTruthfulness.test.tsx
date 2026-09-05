/**
 * Staging UI truthfulness closure — Supabase mode must never present
 * fixture/demo content as live hosted data; fixture mode is unchanged.
 *
 * Proves:
 *   - ModuleGate renders the fixture page in fixture mode and an honest
 *     deferred state (no fixture records) in Supabase mode
 *   - the sidebar shell in Supabase mode shows NO seeded demo markers
 *     ("Seeded demo data", fixture firm/team names, fixture badge counts)
 *     and shows the REAL signed-in identity resolved via the tenancy
 *     boundary
 *   - the fixture-mode shell keeps its seeded presentation untouched
 *
 * Auth is mocked at @/data/auth (both modes, one mutable stub); the
 * tenancy service is mocked at the @/data barrel. No Supabase client is
 * ever instantiated (MIG-DS-06).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModuleGate from '@/components/ModuleGate';
import Navbar from '@/components/Navbar';
import { DemoStoreProvider } from '@/data/store';
import type { AuthService } from '@/data/auth/authService';

const mock = vi.hoisted(() => ({
  mode: 'fixture' as 'fixture' | 'supabase',
}));

vi.mock('@/data/auth', () => ({
  useAuth: () => ({
    snapshot: { status: 'authenticated', user: { id: 'u-1', email: 'stg@caos-staging.test' } },
    service: { mode: mock.mode } as unknown as AuthService,
  }),
}));

vi.mock('@/data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/data')>();
  return {
    ...original,
    tenancyService: {
      mode: 'supabase',
      getMyProfile: async () => ({ id: 'u-1', fullName: 'Real Staff Member', avatarUrl: null }),
      listMyMemberships: async () => [
        {
          membershipId: 'm-1',
          firmId: 'f-1',
          firmName: 'Real Hosted Firm',
          role: 'partner',
          status: 'active',
        },
      ],
    },
    getActiveFirm: () => 'f-1',
    // IMP-041: the review badge is service-backed in both modes; this stub
    // stands in for the RLS-filtered production read (empty queue → no
    // badge), proving no FIXTURE count can leak into the supabase shell.
    reviewService: {
      mode: mock.mode,
      listReviewItems: async () => [],
      subscribeReviewQueue: () => () => {},
    },
  };
});

function renderShell(node: React.ReactElement) {
  return render(
    <MemoryRouter>
      <DemoStoreProvider>{node}</DemoStoreProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mock.mode = 'fixture';
});

describe('ModuleGate', () => {
  it('fixture mode renders the wrapped fixture page unchanged', () => {
    renderShell(
      <ModuleGate title="Review Queue" detail="deferred">
        <div>Fixture module content</div>
      </ModuleGate>,
    );
    expect(screen.getByText('Fixture module content')).toBeInTheDocument();
    expect(screen.queryByText(/coming in a later release/)).not.toBeInTheDocument();
  });

  it('supabase mode renders the honest deferred state, never the fixture page', () => {
    mock.mode = 'supabase';
    renderShell(
      <ModuleGate title="Review Queue" detail="Review items arrive with a later release.">
        <div>Fixture module content</div>
      </ModuleGate>,
    );
    expect(screen.queryByText('Fixture module content')).not.toBeInTheDocument();
    expect(screen.getByText(/Review Queue — coming in a later release/)).toBeInTheDocument();
  });
});

describe('Navbar shell truthfulness', () => {
  it('supabase mode shows no fixture markers and no fake operational counts', async () => {
    mock.mode = 'supabase';
    renderShell(<Navbar mobileOpen={false} onCloseMobile={() => {}} />);
    await waitFor(() => expect(screen.getByText('Real Hosted Firm')).toBeInTheDocument());
    expect(screen.getByText('Real Staff Member')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    // No seeded-demo markers, fixture firm/team names, or fixture badges.
    expect(screen.queryByText(/Seeded demo data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/LK Associates/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lew Kong/)).not.toBeInTheDocument();
    expect(screen.queryByText('21')).not.toBeInTheDocument();
    expect(screen.queryByText('48')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
  });

  it('fixture mode keeps the seeded demo presentation', () => {
    renderShell(<Navbar mobileOpen={false} onCloseMobile={() => {}} />);
    expect(screen.getByText(/Seeded demo data/i)).toBeInTheDocument();
    expect(screen.getByText(/LK Associates/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});
