/**
 * IMP-042 (UI slice) — My Work + alert bell badge component tests,
 * SUPABASE-mode track (mocked at the @/data barrel; no Supabase client is
 * ever instantiated — MIG-DS-06).
 *
 * Proves against mocked provider-neutral services:
 *   - buckets render from myworkService.getMyWork with next_action prominent
 *     (DEC-L / API-R0-MWK);
 *   - role truthfulness: the manager+ Reassign control (RLS-TSK-01
 *     presentation mirror) is hidden from senior; transitions stay offered;
 *   - the waiting transition goes through taskService.transitionTask with the
 *     mandatory non-empty reason, and the buckets re-read after the command
 *     confirms (API-MUT-02 never-optimistic; refetch-on-mutate, API-RT-02);
 *   - reassignment goes through taskService.updateTask's
 *     assigneeMembershipId patch (TEST-E2E-07 enablement);
 *   - an already_applied replay refetches without error styling (API-MUT-03);
 *   - the empty contract (billing / no membership) renders a truthful empty
 *     state, and load failures surface the ApiError message with Retry
 *     (API-ERR-01/02);
 *   - the Layout bell badge in Supabase mode reads the RLS-filtered active
 *     count through alertsService.listAlerts and re-reads on the
 *     subscribeAlerts invalidation signal (API-RT-01/03/05, API-RT-07
 *     polling fallback); the badge carries no fixture count.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

import Layout from '@/components/Layout';
import MyWork from '@/pages/MyWork';
import { DemoStoreProvider } from '@/data/store';
import type { AuthService } from '@/data/auth/authService';
import type { MyWorkBuckets, MyWorkItem, TaskRecord } from '@/data';

const mock = vi.hoisted(() => ({
  role: 'partner' as string,
  getMyWork: vi.fn(),
  transitionTask: vi.fn(),
  updateTask: vi.fn(),
  listAlerts: vi.fn(),
  subscribeAlerts: vi.fn(() => () => {}),
  staff: [
    { membershipId: 'm-priya', fullName: 'Priya Nair', role: 'partner' },
    { membershipId: 'm-rahul', fullName: 'Rahul Verma', role: 'senior' },
  ],
}));

vi.mock('@/data/auth', () => ({
  useAuth: () => ({
    snapshot: { status: 'authenticated', user: { id: 'u-1', email: 'stg@caos-staging.test' } },
    service: { mode: 'supabase' } as unknown as AuthService,
  }),
}));

vi.mock('@/data', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/data')>();
  return {
    ...original,
    getDataSource: () => 'supabase',
    getActiveFirm: () => 'f-1',
    myworkService: { mode: 'supabase', getMyWork: () => mock.getMyWork() },
    taskService: {
      mode: 'supabase',
      transitionTask: (...args: unknown[]) => mock.transitionTask(...args),
      updateTask: (...args: unknown[]) => mock.updateTask(...args),
    },
    client360Service: { mode: 'supabase', listActiveStaff: async () => mock.staff },
    alertsService: {
      mode: 'supabase',
      listAlerts: (filter?: unknown) => mock.listAlerts(filter),
      subscribeAlerts: (onInvalidate: () => void) => mock.subscribeAlerts(onInvalidate),
    },
    tenancyService: {
      mode: 'supabase',
      getMyProfile: async () => ({ id: 'u-1', fullName: 'Real Staff Member', avatarUrl: null }),
      listMyMemberships: async () => [
        {
          membershipId: 'm-1',
          firmId: 'f-1',
          firmName: 'Real Hosted Firm',
          role: mock.role,
          status: 'active',
        },
      ],
    },
    // The Navbar review badge (rendered inside Layout) reads this service in
    // both modes — an empty stub keeps the shell truthful in these tests.
    reviewService: {
      mode: 'supabase',
      listReviewItems: async () => [],
      subscribeReviewQueue: () => () => {},
    },
  };
});

// jsdom has no matchMedia; Radix Select calls pointer-capture/scroll APIs
// jsdom does not implement.
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
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function taskItem(partial: Partial<MyWorkItem>): MyWorkItem {
  return {
    id: 'task-1',
    kind: 'task',
    title: 'GSTR-3B September filing',
    clientId: 'c-1',
    clientName: 'ABC Pvt Ltd',
    dueDate: '2026-09-06',
    priority: 'high',
    status: 'in_progress',
    nextAction: 'Reconcile the purchase register',
    returned: false,
    waitingReason: null,
    taskId: 'task-1',
    reviewItemId: null,
    ...partial,
  };
}

function bucketsWith(partial: Partial<MyWorkBuckets>): MyWorkBuckets {
  return { today: [], thisWeek: [], waiting: [], returned: [], ...partial };
}

const EMPTY = bucketsWith({});

function transitionedTask(): { status: 'transitioned'; task: TaskRecord } {
  return { status: 'transitioned', task: { id: 'task-1' } as TaskRecord };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-work']}>
      <DemoStoreProvider>
        <Routes>
          <Route path="/my-work" element={<MyWork />} />
        </Routes>
      </DemoStoreProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mock.role = 'partner';
  mock.getMyWork.mockReset().mockResolvedValue(EMPTY);
  mock.transitionTask.mockReset().mockResolvedValue(transitionedTask());
  mock.updateTask.mockReset().mockResolvedValue({ id: 'task-1' });
  mock.listAlerts.mockReset().mockResolvedValue([]);
  mock.subscribeAlerts.mockClear();
});

describe('<MyWork /> supabase mode (IMP-042 UI slice)', () => {
  it('renders the buckets from the service with next_action prominent and manager+ controls for a partner', async () => {
    mock.getMyWork.mockResolvedValue(bucketsWith({ today: [taskItem({})] }));
    renderPage();

    expect(await screen.findByText('GSTR-3B September filing')).toBeInTheDocument();
    expect(screen.getByText('1 item across your buckets')).toBeInTheDocument();
    // DEC-L: the explicit next action renders prominently.
    expect(screen.getByText('Reconcile the purchase register')).toBeInTheDocument();
    // Due date renders in mono/tnum; high priority is flagged.
    expect(screen.getByText(/Due 06 Sep 2026/)).toBeInTheDocument();
    expect(screen.getByText('High priority')).toBeInTheDocument();

    // DM-SM-05 forward edges from in_progress + the manager+ reassign
    // control (role resolved via the tenancy boundary — wait for it).
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark waiting…' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reassign…' })).toBeInTheDocument();
  });

  it('hides the manager+ reassign control from a senior but keeps transitions (RLS-TSK-01 mirror)', async () => {
    mock.role = 'senior';
    mock.getMyWork.mockResolvedValue(bucketsWith({ today: [taskItem({})] }));
    renderPage();

    expect(await screen.findByText('GSTR-3B September filing')).toBeInTheDocument();
    // Let the role resolve before asserting absence.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Reassign…' })).not.toBeInTheDocument();
  });

  it('waiting transition requires a non-empty reason and re-reads after the command confirms', async () => {
    const user = userEvent.setup();
    mock.getMyWork.mockResolvedValue(bucketsWith({ today: [taskItem({})] }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Mark waiting…' }));
    await screen.findByRole('dialog');
    const confirm = screen.getByRole('button', { name: 'Mark as waiting' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Waiting reason'), '   ');
    expect(confirm).toBeDisabled();

    await user.clear(screen.getByLabelText('Waiting reason'));
    await user.type(screen.getByLabelText('Waiting reason'), 'Awaiting Form 16 from the client');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(mock.transitionTask).toHaveBeenCalledWith('task-1', {
        targetStatus: 'waiting',
        waitingReason: 'Awaiting Form 16 from the client',
      }),
    );
    // API-MUT-02 / API-RT-02: refetch-on-mutate — initial read + re-read.
    await waitFor(() => expect(mock.getMyWork).toHaveBeenCalledTimes(2));
  });

  it('reassignment goes through taskService.updateTask and re-reads (TEST-E2E-07 enablement)', async () => {
    const user = userEvent.setup();
    mock.getMyWork.mockResolvedValue(bucketsWith({ today: [taskItem({})] }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Reassign…' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Reassign' })).toBeDisabled();

    await user.click(screen.getByLabelText('New assignee'));
    await user.click(await screen.findByRole('option', { name: /Priya Nair/ }));
    await user.click(screen.getByRole('button', { name: 'Reassign' }));

    await waitFor(() =>
      expect(mock.updateTask).toHaveBeenCalledWith('task-1', { assigneeMembershipId: 'm-priya' }),
    );
    await waitFor(() => expect(mock.getMyWork).toHaveBeenCalledTimes(2));
  });

  it('an already_applied replay refetches without an error surface (API-MUT-03)', async () => {
    const user = userEvent.setup();
    mock.transitionTask.mockResolvedValue({
      status: 'already_applied',
      reason: 'already_in_target_status',
      task: { id: 'task-1' },
    });
    mock.getMyWork.mockResolvedValue(bucketsWith({ today: [taskItem({})] }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(mock.transitionTask).toHaveBeenCalledWith('task-1', { targetStatus: 'submitted' }));
    await waitFor(() => expect(mock.getMyWork).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Could not load My Work')).not.toBeInTheDocument();
  });

  it('the empty contract renders a truthful empty state (billing / no membership — never an error)', async () => {
    mock.role = 'billing';
    mock.getMyWork.mockResolvedValue(EMPTY);
    renderPage();

    expect(await screen.findByText('Nothing assigned to you right now')).toBeInTheDocument();
    expect(screen.getByText(/0 items across your buckets/)).toBeInTheDocument();
    expect(screen.queryByText('Could not load My Work')).not.toBeInTheDocument();
  });

  it('a load failure surfaces the ApiError message and Retry re-reads (API-ERR-01)', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/data');
    mock.getMyWork.mockRejectedValueOnce(new ApiError('internal', 'hosted read failed'));
    renderPage();

    expect(await screen.findByText('Could not load My Work')).toBeInTheDocument();
    expect(screen.getByText('hosted read failed')).toBeInTheDocument();

    mock.getMyWork.mockResolvedValue(bucketsWith({ today: [taskItem({})] }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('GSTR-3B September filing')).toBeInTheDocument();
  });

  it('a standalone returned review item is visually distinct with the contract next action and no task controls', async () => {
    mock.getMyWork.mockResolvedValue(
      bucketsWith({
        returned: [
          taskItem({
            id: 'rr-1',
            kind: 'returned_review',
            title: 'ITR computation — AY 2026-27',
            dueDate: null,
            status: 'returned',
            nextAction: 'Address reviewer feedback',
            returned: true,
            taskId: null,
            reviewItemId: 'rr-1',
          }),
        ],
      }),
    );
    renderPage();

    const returned = await screen.findByRole('region', { name: 'Returned' });
    expect(await within(returned).findByText('ITR computation — AY 2026-27')).toBeInTheDocument();
    // DEC-L: the deterministic contract action — never reviewer rationale.
    expect(within(returned).getByText('Address reviewer feedback')).toBeInTheDocument();
    // The Returned marker is visually distinct; there is NO task action on a
    // standalone returned review item (no task identity).
    expect(within(returned).getAllByText('Returned').length).toBeGreaterThan(0);
    expect(within(returned).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('<Layout /> alert bell badge — supabase mode (API-R0-ALR, API-RT-01)', () => {
  function renderShell() {
    return render(
      <MemoryRouter initialEntries={['/my-work']}>
        <DemoStoreProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/my-work" element={<div>page slot</div>} />
            </Route>
          </Routes>
        </DemoStoreProvider>
      </MemoryRouter>,
    );
  }

  it('reads the active count through alertsService and re-reads on invalidation', async () => {
    let invalidate: (() => void) | null = null;
    mock.subscribeAlerts.mockImplementation((cb: () => void) => {
      invalidate = cb;
      return () => {};
    });
    mock.listAlerts.mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }]);

    renderShell();

    // The badge reflects the live RLS-filtered ACTIVE count (the derived
    // effectiveStatus filter), never a fixture count.
    const bell = await screen.findByRole('button', { name: '3 active alerts' });
    expect(bell).toHaveTextContent('3');
    expect(mock.listAlerts).toHaveBeenCalledWith({ status: 'active' });
    expect(mock.subscribeAlerts).toHaveBeenCalledTimes(1);

    // The invalidation signal is bare — the badge re-reads through the
    // service (API-RT-03/05).
    mock.listAlerts.mockResolvedValue([{ id: 'a-1' }]);
    invalidate!();
    expect(await screen.findByRole('button', { name: '1 active alerts' })).toBeInTheDocument();
    expect(mock.listAlerts).toHaveBeenCalledTimes(2);
  });

  it('renders no badge while the count is unknown or zero — never a fabricated number', async () => {
    mock.listAlerts.mockResolvedValue([]);
    renderShell();
    const bell = await screen.findByRole('button', { name: '0 active alerts' });
    expect(bell.querySelector('span')).toBeNull();
  });
});
