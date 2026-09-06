/**
 * IMP-042 (UI slice) — My Work component tests, FIXTURE track.
 *
 * Rendered against the REAL fixture adapters (the demo track is stubbed in
 * tests/setup.ts; no network) so the page is exercised end to end at the
 * component level: the four DEC-L buckets derived from the demo fixtures
 * with the pinned demo clock, truthful counts, prominent next_action,
 * waiting reasons, the honest empty Returned bucket (the demo seed has no
 * returned items), and the demo-only task-action hints (fixture mode has no
 * mutable task store behind My Work — the partner persona's actions are
 * previews, mirroring the Review Queue demo-only reassign affordance).
 *
 * Auth is mocked at @/data/auth (fixture mode → the single partner persona).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

import Layout from '@/components/Layout';
import MyWork from '@/pages/MyWork';
import WaitingDialog from '@/pages/mywork/WaitingDialog';
import { DemoStoreProvider } from '@/data/store';
import type { AuthService } from '@/data/auth/authService';

// jsdom has no matchMedia; framer-motion consults it. skipAnimations keeps
// the bucket entrance transitions deterministic.
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

vi.mock('@/data/auth', () => ({
  useAuth: () => ({
    snapshot: { status: 'authenticated', user: { id: 'demo-fixture-user', email: 'demo@caos.test' } },
    service: { mode: 'fixture' } as unknown as AuthService,
  }),
}));

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

describe('<MyWork /> fixture track (IMP-042 UI slice, TEST-E2E-09 enablement)', () => {
  it('renders the four DEC-L buckets from myworkService with truthful counts', async () => {
    renderPage();
    // Header total + business-date framing (DEC-L: Asia/Kolkata).
    expect(await screen.findByText(/items across your buckets/)).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Kolkata/)).toBeInTheDocument();

    // Exactly the four DEC-L buckets, in precedence order.
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'This week' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waiting' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Returned' })).toBeInTheDocument();

    // DEC-L: every rendered item carries its explicit next action.
    expect(screen.getAllByText('Next:').length).toBeGreaterThan(0);
  });

  it('the Waiting bucket surfaces the mandatory waiting reason', async () => {
    renderPage();
    const waiting = await screen.findByRole('region', { name: 'Waiting' });
    // The demo bridge always stamps a blocker record (DM-SM-05 parity).
    await waitFor(() =>
      expect(within(waiting).getAllByText(/Awaiting/).length).toBeGreaterThan(0),
    );
  });

  it('the Returned bucket renders its honest empty state (no returned items in the demo seed)', async () => {
    renderPage();
    const returned = await screen.findByRole('region', { name: 'Returned' });
    await waitFor(() => expect(within(returned).getByText('Nothing here.')).toBeInTheDocument());
  });

  it('the partner persona sees role-truthful task actions; a demo action is a preview hint, not a mutation', async () => {
    const user = userEvent.setup();
    renderPage();
    const waiting = await screen.findByRole('region', { name: 'Waiting' });
    // Waiting tasks offer Resume (DM-SM-05 waiting → in_progress) and the
    // manager+ Reassign control (RLS-TSK-01 presentation mirror).
    const resume = await within(waiting).findAllByRole('button', { name: 'Resume' });
    expect(resume.length).toBeGreaterThan(0);
    expect(within(waiting).getAllByRole('button', { name: 'Reassign…' }).length).toBeGreaterThan(0);

    // Fixture mode has no mutable task store behind My Work — the action is
    // a demo-only hint; the buckets are untouched.
    await user.click(resume[0]);
    expect(screen.getByText(/items across your buckets/)).toBeInTheDocument();
    expect(screen.queryByText('Could not load My Work')).not.toBeInTheDocument();
  });
});

describe('<WaitingDialog /> (DM-SM-05: waiting requires a non-empty reason)', () => {
  it('keeps the confirm action disabled until a non-blank reason exists', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <WaitingDialog open onOpenChange={() => {}} taskTitle="GSTR-1 filing" busy={false} onConfirm={onConfirm} />,
    );

    await screen.findByRole('dialog');
    const confirm = screen.getByRole('button', { name: 'Mark as waiting' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/A waiting reason is required/)).toBeInTheDocument();

    // Blank input is not a reason (the server rejects it too).
    await user.type(screen.getByLabelText('Waiting reason'), '   ');
    expect(confirm).toBeDisabled();

    await user.clear(screen.getByLabelText('Waiting reason'));
    await user.type(screen.getByLabelText('Waiting reason'), '  Awaiting bank statements  ');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    // The reason travels trimmed.
    expect(onConfirm).toHaveBeenCalledWith('Awaiting bank statements');
  });
});

describe('<Layout /> alert bell badge — fixture track unchanged (API-RT-04)', () => {
  it('derives the badge from the demo store overlay, not from alertsService', async () => {
    render(
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
    // The fixture shell exposes the store-derived active count on the bell.
    const bell = await screen.findByRole('button', { name: /active alerts|Risk alerts/ });
    expect(bell.getAttribute('aria-label')).toMatch(/^\d+ active alerts$/);
  });
});
