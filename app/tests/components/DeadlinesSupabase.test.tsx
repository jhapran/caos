/**
 * IMP-060 (UI slice) — Deadlines board component tests, SUPABASE-mode track
 * (mocked at the @/data barrel; no Supabase client is ever instantiated —
 * MIG-DS-06).
 *
 * Proves against the mocked deadlinesService (H7):
 *   - the board renders ALL live deadline_board groups (overdue included),
 *     sorted by due date ascending by default;
 *   - search filters by compliance name only; the demo-only category filter
 *     and table/timeline toggle are hidden;
 *   - drilling a row navigates to the canonical groupId drill-down;
 *   - a failed read surfaces a truthful error state with Retry;
 *   - an empty scope renders a truthful empty board.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

import Deadlines from '@/pages/Deadlines';
import { DemoStoreProvider } from '@/data/store';
import type { AuthService } from '@/data/auth/authService';
import type { DeadlineGroupRecord } from '@/data';

const mock = vi.hoisted(() => ({
  mode: 'supabase' as 'fixture' | 'supabase',
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
    deadlinesService: {
      mode: 'supabase',
      listDeadlineGroups: () => mock.listDeadlineGroups(),
      listDeadlineGroupInstances: (groupId: string) => mock.listDeadlineGroupInstances(groupId),
      listClientDependencies: () => mock.listClientDependencies(),
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

const GROUPS: DeadlineGroupRecord[] = [
  group({}),
  group({
    groupId: 'ct-tds24q::2026-09-30',
    complianceTypeId: 'ct-tds24q',
    complianceName: 'TDS Return 24Q',
    dueDate: '2026-09-30',
    daysLeft: 11,
    totalClients: 8,
    waiting: 0,
    atRisk: 0,
  }),
  group({
    groupId: 'ct-advtax::2026-09-15',
    complianceTypeId: 'ct-advtax',
    complianceName: 'Advance Tax',
    dueDate: '2026-09-15',
    daysLeft: -4,
    totalClients: 5,
    waiting: 1,
    atRisk: 3,
  }),
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/deadlines']}>
      <DemoStoreProvider>
        <Routes>
          <Route path="/deadlines" element={<Deadlines />} />
          <Route path="/deadlines/:id/clients" element={<div>group drill-down destination</div>} />
        </Routes>
      </DemoStoreProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mock.mode = 'supabase';
  mock.listDeadlineGroups.mockReset().mockResolvedValue(GROUPS);
  mock.listDeadlineGroupInstances.mockReset().mockResolvedValue([]);
  mock.listClientDependencies.mockReset().mockResolvedValue([]);
});

describe('<Deadlines /> supabase mode (IMP-060 UI slice)', () => {
  it('renders all live groups (overdue included) with truthful footer counts', async () => {
    renderPage();

    expect(await screen.findByText('GSTR-1')).toBeInTheDocument();
    expect(screen.getByText('TDS Return 24Q')).toBeInTheDocument();
    // Overdue groups render — they are the at-risk truth.
    expect(screen.getByText('Advance Tax')).toBeInTheDocument();
    expect(screen.getByText(/Overdue by 4 days/)).toBeInTheDocument();
    expect(screen.getByText(/3 deadline groups · 25 client obligations/)).toBeInTheDocument();
  });

  it('hides the demo-only category filter and timeline toggle; search filters by compliance name', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('GSTR-1')).toBeInTheDocument();
    expect(screen.queryByText('Payroll')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Timeline' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search compliance…')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search compliance…'), 'tds');
    expect(screen.queryByText('GSTR-1')).not.toBeInTheDocument();
    expect(screen.getByText('TDS Return 24Q')).toBeInTheDocument();
    expect(screen.queryByText('No deadlines match')).not.toBeInTheDocument();
  });

  it('a search miss renders the filter empty state, a clear restores the board', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByPlaceholderText('Search compliance…'), 'zzz');
    expect(await screen.findByText('No deadlines match')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('GSTR-1')).toBeInTheDocument();
  });

  it('drills a row to the canonical groupId client list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('TDS Return 24Q'));
    expect(await screen.findByText('group drill-down destination')).toBeInTheDocument();
  });

  it('a failed read surfaces a truthful error state with Retry', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/data');
    mock.listDeadlineGroups.mockReset().mockRejectedValue(new ApiError('internal', 'board read failed'));
    renderPage();

    expect(await screen.findByText('Could not load the deadlines board')).toBeInTheDocument();
    expect(screen.getByText('board read failed')).toBeInTheDocument();

    mock.listDeadlineGroups.mockResolvedValue(GROUPS);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('GSTR-1')).toBeInTheDocument();
  });

  it('an empty scope renders a truthful empty board — never fabricated rows', async () => {
    mock.listDeadlineGroups.mockReset().mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No upcoming deadlines')).toBeInTheDocument();
    expect(
      screen.getByText('No open compliance obligations are scheduled in your scope.'),
    ).toBeInTheDocument();
  });
});

describe('<Deadlines /> fixture mode regression', () => {
  it('keeps the seeded demo board unchanged', async () => {
    mock.mode = 'fixture';
    renderPage();

    expect(await screen.findByPlaceholderText('Search compliance or client…')).toBeInTheDocument();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeInTheDocument();
  });
});
