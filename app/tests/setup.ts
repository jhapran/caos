// Shared Vitest setup (IMP-001). Registers jest-dom matchers on Vitest's
// expect (toBeInTheDocument, toHaveClass, …). No fixture network latency is
// involved: unit/component tests never touch the @/data async fetchers.
// IMP-011: explicit RTL cleanup between tests — Vitest runs with globals
// disabled, so @testing-library/react's auto-cleanup hook never installs.
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
