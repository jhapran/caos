/**
 * IMP-014 — Visible fail-closed startup (OPS-ENV-06, MIG-DS-03/05).
 *
 * Proves the bootstrap boundary end-to-end in jsdom: with an invalid or
 * incomplete configuration, importing the application entry point renders
 * the visible ConfigErrorScreen — never a blank page, never a permanent
 * spinner, never a console-only failure, and the feature tree (App,
 * router, providers) is never imported/mounted.
 */
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigErrorScreen } from '@/components/ConfigErrorScreen';

function freshRoot(): void {
  document.body.innerHTML = '';
  const div = document.createElement('div');
  div.id = 'root';
  document.body.appendChild(div);
}

describe('ConfigErrorScreen component', () => {
  it('renders the configuration error visibly with the reason', () => {
    render(<ConfigErrorScreen error={new Error('Invalid VITE_DATA_SOURCE "bogus"')} />);
    expect(screen.getByText(/configuration error/i)).toBeInTheDocument();
    expect(screen.getByText(/CAOS cannot start/i)).toBeInTheDocument();
    expect(screen.getByText(/Invalid VITE_DATA_SOURCE/)).toBeInTheDocument();
    expect(screen.getAllByText(/VITE_DATA_SOURCE/).length).toBeGreaterThan(0);
  });
});

describe('bootstrap boundary (src/main.tsx)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('invalid DATA_SOURCE renders the fatal screen and never boots the feature tree', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'bogus');
    freshRoot();

    await import('@/main');

    await waitFor(() =>
      expect(screen.getByText(/CAOS cannot start/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/configuration error/i)).toBeInTheDocument();
    expect(screen.getByText(/MIG-DS-05/)).toBeInTheDocument();
    // The app shell/router never mounted — no navigation, no landing page.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('supabase mode with missing client-safe config fails before any feature code runs', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'supabase');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    freshRoot();

    await import('@/main');

    await waitFor(() =>
      expect(screen.getByText(/CAOS cannot start/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/MIG-DS-03/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('fixture mode boots the feature tree (App mounted)', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', 'fixture');
    // The real Landing page needs browser APIs jsdom lacks (GSAP
    // matchMedia); the full fixture shell boot is proven by the Playwright
    // smoke. Here a stand-in App proves the bootstrap mounts the provider
    // tree when configuration is valid.
    vi.doMock('@/App.tsx', () => ({
      default: () => <div data-testid="app-booted">APP-BOOTED</div>,
    }));
    freshRoot();

    await import('@/main');

    await waitFor(() => expect(screen.getByTestId('app-booted')).toBeInTheDocument());
    expect(screen.queryByText(/CAOS cannot start/i)).not.toBeInTheDocument();
  });
});
