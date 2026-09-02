// Shared Vitest setup (IMP-001). Registers jest-dom matchers on Vitest's
// expect (toBeInTheDocument, toHaveClass, …). No fixture network latency is
// involved: unit/component tests never touch the @/data async fetchers.
// IMP-011: explicit RTL cleanup between tests — Vitest runs with globals
// disabled, so @testing-library/react's auto-cleanup hook never installs.
// IMP-014: unit/component tests run on the fixture demo track by default
// (MIG-DS-05 — there is no default mode, so the track must be explicit).
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.stubEnv('VITE_DATA_SOURCE', 'fixture');

afterEach(() => {
  cleanup();
});
