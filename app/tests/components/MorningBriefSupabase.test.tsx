/**
 * IMP-060 (UI slice) — Morning Brief component tests, SUPABASE-mode track
 * (mocked at the @/data barrel; no Supabase client is ever instantiated —
 * MIG-DS-06).
 *
 * Proves against mocked provider-neutral services:
 *   - the greeting names the REAL signed-in identity (useShellIdentity) and
 *     the caption carries the real date + firm name — no fixture persona;
 *   - the hard-coded "17 items need attention today" line is REMOVED (H2);
 *   - posture chips expose ONLY the approved counters (at-risk deadlines,
 *     pending reviews, active alerts) — no "Critical 5", no "On Track" (H3);
 *   - Team Overload (H4) and Billing (H5) render explicit deferred tiles
 *     with no numbers and no currency values;
 *   - the Attention List is an explicit deferred panel (H6) — no fixture
 *     rows, no "Generated 8:58 AM", no replay;
 *   - the live tiles render approved counters and the deadline board groups.
 * Fixture mode regression: the demo presentation is unchanged.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

import MorningBrief from '@/pages/MorningBrief';
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
      not_started: 4,
      preparation: 3,
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
    <MemoryRouter initialEntries={['/brief']}>
      <DemoStoreProvider>
        <MorningBrief />
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
    dep({ id: 'dep-2', clientId: 'c-2', clientName: 'Beacon Foods', ageDays: 2 }),
  ]);
});

describe('<MorningBrief /> supabase mode (IMP-060 UI slice)', () => {
  it('greets the real identity with the real date and firm — and NO attention count (H2)', async () => {
    renderPage();

    expect(await screen.findByText('Real Staff Member.')).toBeInTheDocument();
    expect(await screen.findByText(/Real Hosted Firm/)).toBeInTheDocument();
    // H2: the hard-coded attention line is gone — no replacement number.
    expect(screen.queryByText(/items need attention today/)).not.toBeInTheDocument();
    // No fixture persona.
    expect(screen.queryByText(/Lew Kong/)).not.toBeInTheDocument();
  });

  it('posture chips expose ONLY the approved counters (H3) — no Critical 5, no On Track', async () => {
    renderPage();

    expect(await screen.findByText('At-risk deadlines')).toBeInTheDocument();
    expect(screen.getByText('Pending reviews')).toBeInTheDocument();
    expect(screen.getByText('Active alerts')).toBeInTheDocument();
    // The approved counters render (chip + tile both surface the value).
    expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    expect(screen.queryByText('On Track')).not.toBeInTheDocument();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.queryByText('684')).not.toBeInTheDocument();
    // IMP-060: ONE aggregate composition per page render — GreetingBand and
    // BriefCards share the page-level hook result.
    expect(mock.getDashboardAggregates).toHaveBeenCalledTimes(1);
  });

  it('renders the live tiles from the approved counters and the deadline board', async () => {
    renderPage();

    // Compliance Risk tile — at-risk count + open-obligations caption.
    expect(await screen.findByText('at-risk deadlines')).toBeInTheDocument();
    expect(screen.getByText('7 open compliance obligations in your scope')).toBeInTheDocument();
    // Waiting for Clients tile — live dependency counts.
    expect(screen.getByText('clients with open items')).toBeInTheDocument();
    expect(screen.getByText('2 open items awaiting client information')).toBeInTheDocument();
    // Awaiting Review tile.
    expect(screen.getByText('items pending review')).toBeInTheDocument();
    // Upcoming Deadlines tile — live board groups.
    expect(screen.getByText('GSTR-1')).toBeInTheDocument();
    expect(screen.getByText('TDS Return 24Q')).toBeInTheDocument();
    // No fixture tile narratives.
    expect(screen.queryByText(/engagements on track/)).not.toBeInTheDocument();
    expect(screen.queryByText(/clients owe documents/)).not.toBeInTheDocument();
  });

  it('Team Overload (H4) and Billing (H5) are explicit deferred tiles with no numbers', async () => {
    renderPage();

    expect(await screen.findByText('Team workload analytics arrive with a later release.')).toBeInTheDocument();
    expect(screen.getByText('Billing and receivables arrive with a later release.')).toBeInTheDocument();
    // No overload numbers, no currency anywhere.
    expect(screen.queryByText(/employees past capacity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rahul Verma/)).not.toBeInTheDocument();
    expect(screen.queryByText(/₹8\.4/)).not.toBeInTheDocument();
    expect(screen.queryByText(/invoices more than 90 days overdue/)).not.toBeInTheDocument();
    // The deferred tiles do not navigate.
    expect(screen.queryByRole('button', { name: /team overload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /billing/i })).not.toBeInTheDocument();
  });

  it('the Attention List is an explicit deferred panel (H6)', async () => {
    renderPage();

    expect(await screen.findByText('Attention list — coming in a later release')).toBeInTheDocument();
    expect(screen.queryByText(/Generated 8:58 AM/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replay morning answer/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/CAOS is prioritising/)).not.toBeInTheDocument();
    // No fixture attention rows.
    expect(screen.queryByText('ABC Pvt Ltd')).not.toBeInTheDocument();
    expect(screen.queryByText(/DSC/)).not.toBeInTheDocument();
  });
});

describe('<MorningBrief /> fixture mode regression', () => {
  it('keeps the seeded demo presentation unchanged', async () => {
    mock.mode = 'fixture';
    renderPage();

    expect(await screen.findByText(/items need attention today/)).toBeInTheDocument();
    expect(screen.getByText('On Track')).toBeInTheDocument();
    expect(screen.getByText(/CA Lew Kong/)).toBeInTheDocument();
    expect(screen.getByText(/employees past capacity/)).toBeInTheDocument();
    expect(screen.getByText(/₹8\.4/)).toBeInTheDocument();
    expect(screen.getByText(/Generated 8:58 AM/)).toBeInTheDocument();
  });
});
