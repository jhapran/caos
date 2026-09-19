/**
 * IMP-060 (UI slice) — Command Centre component tests, SUPABASE-mode track
 * (mocked at the @/data barrel; no Supabase client is ever instantiated —
 * MIG-DS-06).
 *
 * Proves against mocked provider-neutral services:
 *   - Compliance Health renders the live DM-SM-04 state truth
 *     (complianceInstanceCountsByState) and the deadline_board at-risk
 *     derivation (H1) — no fixture task-category semantics, no "FY 2024-25"
 *     caption, no "28 clients" hints;
 *   - the page header drops the demo-only FY switcher and the hard-coded
 *     "Last synced 09:12" badge;
 *   - the deadlines card renders live deadline_board groups and drills on
 *     the canonical groupId (H7);
 *   - the dependency card renders truthful live client counts with NO Nudge
 *     button and NO /dependency "See all" link (H7);
 *   - the review and risk cards render ONLY the approved counters
 *     (reviewPending / activeAlerts, H3) — no per-type meters, no fixture
 *     alert list;
 *   - a failed aggregate read surfaces a truthful error state with Retry.
 * Fixture mode regression: the demo presentation is unchanged.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

import CommandCentre from '@/pages/CommandCentre';
import { DemoStoreProvider } from '@/data/store';
import type { AuthService } from '@/data/auth/authService';
import type { ClientDependencyRecord, DashboardAggregates, DeadlineGroupRecord } from '@/data';
import { emptyDashboardAggregates } from '@/data';

const mock = vi.hoisted(() => ({
  mode: 'supabase' as 'fixture' | 'supabase',
  getDashboardAggregates: vi.fn(),
  listDeadlineGroups: vi.fn(),
  listDeadlineGroupInstances: vi.fn(),
  listClientDependencies: vi.fn(),
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
    getDataSource: () => mock.mode,
    getActiveFirm: () => 'f-1',
    dashboardService: {
      mode: 'supabase',
      getDashboardAggregates: () => mock.getDashboardAggregates(),
    },
    deadlinesService: {
      mode: 'supabase',
      listDeadlineGroups: () => mock.listDeadlineGroups(),
      listDeadlineGroupInstances: (groupId: string) => mock.listDeadlineGroupInstances(groupId),
      listClientDependencies: () => mock.listClientDependencies(),
    },
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
  };
});

// jsdom has no matchMedia; matches:true reduces motion so CountUp snaps.
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
  window.matchMedia ??= ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

function liveAggregates(): DashboardAggregates {
  const base = emptyDashboardAggregates();
  return {
    ...base,
    complianceInstanceCountsByState: {
      ...base.complianceInstanceCountsByState,
      not_started: 3,
      information_requested: 2,
      preparation: 4,
      internal_review: 1,
      ready_to_file: 2,
      filed: 5,
      closed: 6,
    },
    atRiskDeadlines: 7,
    reviewPending: 9,
    activeAlerts: 4,
  };
}

function group(partial: Partial<DeadlineGroupRecord>): DeadlineGroupRecord {
  return {
    groupId: 'ct-gstr1::2026-09-20',
    complianceTypeId: 'ct-gstr1',
    complianceName: 'GSTR-1',
    dueDate: '2026-09-20',
    daysLeft: 1,
    totalClients: 12,
    filed: 2,
    readyToFile: 3,
    inProgress: 4,
    waiting: 2,
    underReview: 1,
    notStarted: 0,
    atRisk: 1,
    ...partial,
  };
}

function dep(partial: Partial<ClientDependencyRecord>): ClientDependencyRecord {
  return {
    kind: 'instance',
    id: 'dep-1',
    clientId: 'c-1',
    clientName: 'Acme Textiles',
    label: 'GSTR-1',
    periodLabel: 'Sep 2026',
    waitingReason: null,
    status: 'information_requested',
    waitingSince: null,
    ageDays: 9,
    dueDate: '2026-09-20',
    assigneeMembershipId: null,
    reviewerMembershipId: null,
    ...partial,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/command']}>
      <DemoStoreProvider>
        <Routes>
          <Route path="/command" element={<CommandCentre />} />
          <Route path="/deadlines/:id/clients" element={<div>group drill-down destination</div>} />
          <Route path="/deadlines" element={<div>deadlines board destination</div>} />
        </Routes>
      </DemoStoreProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mock.mode = 'supabase';
  mock.getDashboardAggregates.mockReset().mockResolvedValue(liveAggregates());
  mock.listDeadlineGroups.mockReset().mockResolvedValue([
    group({}),
    group({
      groupId: 'ct-tds24q::2026-09-30',
      complianceTypeId: 'ct-tds24q',
      complianceName: 'TDS Return 24Q',
      dueDate: '2026-09-30',
      daysLeft: 11,
      totalClients: 8,
      atRisk: 0,
    }),
  ]);
  mock.listDeadlineGroupInstances.mockReset().mockResolvedValue([]);
  mock.listClientDependencies.mockReset().mockResolvedValue([
    dep({}),
    dep({
      kind: 'task',
      id: 'dep-2',
      label: 'Bank statement follow-up',
      periodLabel: null,
      status: 'waiting',
      waitingReason: 'Awaiting documents',
      ageDays: 4,
      dueDate: null,
    }),
    dep({
      id: 'dep-3',
      clientId: 'c-2',
      clientName: 'Beacon Foods',
      ageDays: 2,
    }),
  ]);
});

describe('<CommandCentre /> supabase mode (IMP-060 UI slice)', () => {
  it('renders the live compliance-instance state truth (H1) with the at-risk chip outside the partition', async () => {
    renderPage();

    // Hero: sum of the open (pre-closure) DM-SM-04 states = 3+2+4+1+2+5 = 17.
    expect(await screen.findByText('open compliance obligations')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    // Truthful live caption — no FY, no fixture engagement claims.
    expect(screen.getByText('Live compliance-instance states')).toBeInTheDocument();
    expect(screen.queryByText(/FY 2024-25/)).not.toBeInTheDocument();
    expect(screen.queryByText(/28 clients/)).not.toBeInTheDocument();
    // The six state-truth segments.
    expect(screen.getByText('Not Started')).toBeInTheDocument();
    expect(screen.getByText('Waiting for Client')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Under Review')).toBeInTheDocument();
    expect(screen.getByText('Ready to File')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    // The additional At Risk chip from the deadline_board derivation.
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    // IMP-060: ONE aggregate composition per page render — the three
    // consuming cards share the page-level hook result.
    expect(mock.getDashboardAggregates).toHaveBeenCalledTimes(1);
  });

  it('drops the demo-only FY switcher and the hard-coded sync badge', async () => {
    renderPage();
    expect(await screen.findByText('open compliance obligations')).toBeInTheDocument();
    expect(screen.queryByText('Last synced 09:12')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'FY 2023-24' })).not.toBeInTheDocument();
  });

  it('renders live deadline board groups and drills on the canonical groupId (H7)', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('GSTR-1')).toBeInTheDocument();
    expect(screen.getByText('TDS Return 24Q')).toBeInTheDocument();

    await user.click(screen.getByText('GSTR-1'));
    expect(await screen.findByText('group drill-down destination')).toBeInTheDocument();
    expect(mock.listDeadlineGroups).toHaveBeenCalled();
  });

  it('renders truthful live client-dependency counts with no Nudge and no gated See-all link (H7)', async () => {
    renderPage();

    expect(await screen.findByText('2 clients · 3 open dependency items')).toBeInTheDocument();
    expect(screen.getByText('Acme Textiles')).toBeInTheDocument();
    expect(screen.getByText('2 open items · oldest 9 days ago')).toBeInTheDocument();
    // Demo-only affordances are off.
    expect(screen.queryByRole('button', { name: /nudge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /see all/i })).not.toBeInTheDocument();
  });

  it('renders only the approved review and alert counters (H3)', async () => {
    renderPage();

    expect(await screen.findByText(/items awaiting review/)).toBeInTheDocument();
    expect(screen.getByText('Per-type breakdown lives in the Review Queue.')).toBeInTheDocument();
    expect(screen.queryByText(/oldest waiting/i)).not.toBeInTheDocument();

    expect(screen.getByText('4 active')).toBeInTheDocument();
    expect(
      screen.getByText('Detailed alert triage arrives with the Risk Alerts module in a later release.'),
    ).toBeInTheDocument();
    // Both counter cards read the ONE page-level composition.
    expect(mock.getDashboardAggregates).toHaveBeenCalledTimes(1);
    // The /alerts page stays gated — no link to it from the live card.
    await waitFor(() => {
      const alertLinks = screen
        .queryAllByRole('link')
        .filter((a) => a.getAttribute('href') === '/alerts');
      expect(alertLinks).toHaveLength(0);
    });
  });

  it('a failed aggregate read surfaces a truthful error state with Retry — never a fabricated zero', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/data');
    mock.getDashboardAggregates.mockReset().mockRejectedValue(new ApiError('internal', 'hosted read failed'));
    renderPage();

    expect(await screen.findAllByText('Could not load compliance health')).not.toHaveLength(0);
    expect(screen.getAllByText('hosted read failed').length).toBeGreaterThan(0);
    // No fixture hero number leaks through on error.
    expect(screen.queryByText('active compliances')).not.toBeInTheDocument();

    mock.getDashboardAggregates.mockResolvedValue(liveAggregates());
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(await screen.findByText('open compliance obligations')).toBeInTheDocument();
  });
});

describe('<CommandCentre /> fixture mode regression', () => {
  it('keeps the seeded demo presentation unchanged', async () => {
    mock.mode = 'fixture';
    renderPage();

    expect(await screen.findByText('Last synced 09:12')).toBeInTheDocument();
    expect(screen.getByText('FY 2024-25')).toBeInTheDocument();
    expect(screen.getByText('active compliances')).toBeInTheDocument();
    expect(screen.getByText(/All active engagements · FY 2024-25/)).toBeInTheDocument();
    expect(screen.getByText(/clients currently blocking/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /nudge/i }).length).toBeGreaterThan(0);
  });
});
