/**
 * IMP-022 — Client 360 + Clients list component tests (TEST-COMP-*).
 *
 * Rendered against the REAL fixture adapters (the demo track is stubbed
 * in tests/setup.ts; no network, no mocks) so the composite read model,
 * tab structure, and all state surfaces are exercised end to end at the
 * component level.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import Client360Page from '@/pages/clients/Client360Page';
import ClientsPage from '@/pages/clients/ClientsPage';

function renderClient360(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/clients/${id}`]}>
      <Routes>
        <Route path="/clients/:clientId" element={<Client360Page />} />
        <Route path="/clients" element={<ClientsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<Client360Page /> (IMP-022, TEST-COMP)', () => {
  it('renders the overview for an accessible client', async () => {
    renderClient360('c-abc');
    expect(await screen.findByRole('heading', { name: 'ABC Pvt Ltd' })).toBeInTheDocument();
    // Overview fields: industry, partner name (never a membership UUID),
    // identifiers from registrations.
    expect(screen.getByText('Manufacturing')).toBeInTheDocument();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText(/PAN AABCA1234F/)).toBeInTheDocument();
    // Contacts section renders its empty state distinctly.
    expect(screen.getByText('No contacts recorded for this client.')).toBeInTheDocument();
  });

  it('renders entities, registrations, and engagements under their tabs', async () => {
    const user = userEvent.setup();
    renderClient360('c-abc');

    await user.click(await screen.findByRole('tab', { name: /Entities & identifiers/ }));
    expect(await screen.findByText('27AABCA1234F1Z5')).toBeInTheDocument();
    expect(screen.getByText(/Private Limited/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Engagements/ }));
    // Letter status pill + the "Signed" column header both render.
    expect((await screen.findAllByText('Signed')).length).toBeGreaterThan(0);
    expect(screen.getByText('FY 2025-26')).toBeInTheDocument();
  });

  it('renders the approved deferred/placeholder tabs without fabricating data', async () => {
    const user = userEvent.setup();
    renderClient360('c-abc');

    await user.click(await screen.findByRole('tab', { name: 'Compliance' }));
    expect(await screen.findByText(/Compliance — coming in a later release/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Communications' }));
    expect(await screen.findByText('No communications yet')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText(/Documents — coming in a later release/)).toBeInTheDocument();
  });

  it('shows one identical not-found surface for unknown and malformed ids (API-ERR-02)', async () => {
    const { unmount } = renderClient360('c-does-not-exist');
    expect(await screen.findByText('Client not found')).toBeInTheDocument();
    expect(screen.getByText('Back to clients')).toBeInTheDocument();
    unmount();

    renderClient360('not-a-uuid');
    expect(await screen.findByText('Client not found')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load/)).not.toBeInTheDocument();
  });

  it('shows an empty-relationships state distinct from a missing client', async () => {
    const user = userEvent.setup();
    renderClient360('c-abc');
    await user.click(await screen.findByRole('tab', { name: /Relationships/ }));
    expect(await screen.findByText('No relationships')).toBeInTheDocument();
  });
});

describe('<ClientsPage /> (IMP-022, TEST-COMP)', () => {
  it('lists demo clients and links into Client 360', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/clients']}>
        <Routes>
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<Client360Page />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('ABC Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('XYZ LLP')).toBeInTheDocument();
    // Fixture demo role is partner → the create affordance is visible.
    expect(screen.getByRole('button', { name: /New client/ })).toBeInTheDocument();

    await user.click(screen.getByText('ABC Pvt Ltd'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'ABC Pvt Ltd' })).toBeInTheDocument(),
    );
  });
});
