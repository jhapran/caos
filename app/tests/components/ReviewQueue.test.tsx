/**
 * IMP-041 PASS C — Review Queue component tests (fixture track).
 *
 * Rendered against the REAL fixture adapters (the demo track is stubbed in
 * tests/setup.ts; no network) so the page is exercised end to end at the
 * component level: loading → R0-vocabulary rows, truthful pending count, the
 * rationale-gated approve/return forms (never optimistic — API-MUT-02), and
 * the RLS-4EY-04 self-decision denial surfaced from the fixture adapter.
 *
 * Auth is mocked at @/data/auth (fixture mode → the single partner persona).
 * TEST-E2E-08 covers the dialog in a real browser; the PASS C.1 describe
 * below additionally exercises the task-mode (senior/article) submission
 * interaction in jsdom.
 *
 * NOTE: the fixture review store is module-local and shared across the tests
 * in this file — the scenarios below are SEQUENCED (each builds on the
 * previous mutations) so earlier decisions cannot poison later assertions.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MotionGlobalConfig } from 'framer-motion';

import ReviewQueue from '@/pages/ReviewQueue';
import SubmitDialog from '@/pages/review/SubmitDialog';
import { DemoStoreProvider } from '@/data/store';
import type { AuthService } from '@/data/auth/authService';

// jsdom has no matchMedia; CountUp/framer-motion consult it. Reduced-motion
// short-circuits the count animation so assertions are deterministic.
// IntersectionObserver backs the demo footer's whileInView — a no-op stub.
// skipAnimations makes AnimatePresence exit transitions complete immediately
// (they otherwise stall in jsdom and leave exiting nodes in the DOM).
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
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

vi.mock('@/data/auth', () => ({
  useAuth: () => ({
    snapshot: { status: 'authenticated', user: { id: 'demo-fixture-user', email: 'demo@caos.test' } },
    service: { mode: 'fixture' } as unknown as AuthService,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/review']}>
      <DemoStoreProvider>
        <Routes>
          <Route path="/review" element={<ReviewQueue />} />
        </Routes>
      </DemoStoreProvider>
    </MemoryRouter>,
  );
}

describe('<ReviewQueue /> (IMP-041 PASS C)', () => {
  it('loads the queue through @/data and renders a truthful pending count', async () => {
    renderPage();
    // 21 seeded items, all pending, oldest first.
    expect(await screen.findByText('21 items awaiting review')).toBeInTheDocument();
    expect(await screen.findByText(/GSTR-2A vs purchase register reco/)).toBeInTheDocument();
    // R0-keyed filter chips render their display labels.
    expect(screen.getByRole('button', { name: /GST reconciliations/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Audit workpapers/ })).toBeInTheDocument();
    // Fixture persona (partner): decision + submission controls are offered.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit for review/ })).toBeInTheDocument();
  });

  it('approve requires a rationale and removes the row only after the command confirms', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('21 items awaiting review');
    // The auto-selected row is the OLDEST pending item (r-21) — its title
    // appears in both the row and the inspector.
    expect((await screen.findAllByText(/Statutory dues wp/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Confirm approval' });
    // Client-side UX guard: disabled until a non-blank rationale exists.
    expect(confirm).toBeDisabled();
    expect(screen.getByText('A rationale is required for every review decision.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Approval rationale'), '   ');
    expect(confirm).toBeDisabled();

    await user.clear(screen.getByLabelText('Approval rationale'));
    await user.type(screen.getByLabelText('Approval rationale'), 'Schedules tie out.');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    // Non-optimistic (API-MUT-02): the row leaves the queue only after the
    // command confirms and the list re-reads. 21 → 20. (The exiting row node
    // can linger in jsdom — AnimatePresence exit animations never fire their
    // completion event there — so the authoritative assertions are the count
    // and the inspector heading, not DOM absence of the row.)
    await waitFor(() =>
      expect(screen.getByText('20 items awaiting review')).toBeInTheDocument(),
    );
    await waitFor(
      () =>
        expect(
          screen.queryByRole('heading', { name: /Statutory dues wp/ }),
        ).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('return requires a rationale and removes the row after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    // 20 pending after the approval above; the oldest is now r-20.
    await screen.findByText('20 items awaiting review');
    expect((await screen.findAllByText(/Debtors confirmation wp/)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Return' }));
    const confirm = screen.getByRole('button', { name: /Return to/ });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Return reason'), 'Attach the revised register.');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(screen.getByText('19 items awaiting review')).toBeInTheDocument(),
    );
    await waitFor(
      () =>
        expect(
          screen.queryByRole('heading', { name: /Debtors confirmation wp/ }),
        ).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('self-decision denial from the service keeps the row pending (RLS-4EY-04)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('19 items awaiting review');

    // Submit an item as the fixture persona, then try to decide it.
    const { reviewService } = await import('@/data');
    const own = await reviewService.submitReviewItem({
      clientId: 'c-abc',
      type: 'audit_workpaper',
      title: 'Self-decision probe wp',
    });
    expect(own.submittedByMembershipId).toBe('demo-fixture-membership');

    // The local invalidation subscription refetches → the row appears. 19 → 20.
    const row = await screen.findByText(/Self-decision probe wp/);
    await waitFor(() => expect(screen.getByText('20 items awaiting review')).toBeInTheDocument());
    await user.click(row);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.type(screen.getByLabelText('Approval rationale'), 'self approve');
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));

    // The denial is not optimistic: the row stays in the queue (its title is
    // shown in both the row and the inspector once selected).
    await waitFor(() =>
      expect(screen.getByText('20 items awaiting review')).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/Self-decision probe wp/).length).toBeGreaterThan(0);
  });

  it('type filter narrows the queue to the R0-keyed chip vocabulary', async () => {
    const user = userEvent.setup();
    renderPage();
    // 20 pending (19 + the self-decision probe).
    await screen.findByText('20 items awaiting review');

    await user.click(screen.getByRole('button', { name: /TDS returns/ }));
    // The header count is the truthful TOTAL pending (20) — the chip narrows
    // the list; the inspector selection moves to the oldest TDS item.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Lower deduction certificate application/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/TDS 26Q deduction mapping/)).toBeInTheDocument();
    expect(screen.getByText('20 items awaiting review')).toBeInTheDocument();
  });

  it('the submission dialog renders its required-field skeleton (full flow in TEST-E2E-08)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/items awaiting review/);

    await user.click(screen.getByRole('button', { name: /Submit for review/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
    expect(screen.getByLabelText('Work type')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    // Nothing selected yet → the submit action stays disabled.
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  });
});

describe('<SubmitDialog /> subject modes (IMP-041 PASS C.1)', () => {
  // Radix Select calls pointer-capture/scroll APIs jsdom does not implement.
  beforeAll(() => {
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

  it("task mode (senior/article): assigned-work picker, no client list, taskId-only submission with derived client", async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    render(
      <DemoStoreProvider>
        <SubmitDialog open onOpenChange={() => {}} subjectMode="task" onSubmitted={onSubmitted} />
      </DemoStoreProvider>,
    );

    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Assigned work item')).toBeInTheDocument();
    // No client enumeration surface for this role — ever.
    expect(screen.queryByLabelText('Client')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();

    // Options come ONLY from taskService (provider-scoped assigned work).
    await user.click(screen.getByLabelText('Assigned work item'));
    await user.click(await screen.findByRole('option', { name: /GSTR-1 August 2026 filing/ }));

    await user.click(screen.getByLabelText('Work type'));
    await user.click(await screen.findByRole('option', { name: 'GST Reconciliation' }));
    await user.type(screen.getByLabelText('Title'), 'C.1 task-linked probe');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    // The submission carried taskId ONLY; the provider derived clientId from
    // the linked task — mirroring the server-side SCH-17 subject binding.
    const { reviewService } = await import('@/data');
    const items = await reviewService.listReviewItems();
    const mine = items.find((i) => i.title === 'C.1 task-linked probe');
    expect(mine).toBeDefined();
    expect(mine?.taskId).toBe('task-abc-gstr1-filing');
    expect(mine?.clientId).toBe('c-abc');
    expect(mine?.status).toBe('pending');
  });

  it('client mode (manager+): client picker, no assigned-work picker', async () => {
    render(
      <DemoStoreProvider>
        <SubmitDialog open onOpenChange={() => {}} subjectMode="client" onSubmitted={() => {}} />
      </DemoStoreProvider>,
    );
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
    expect(screen.queryByLabelText('Assigned work item')).not.toBeInTheDocument();
    // Nothing selected yet → the submit action stays disabled.
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  });
});
