// Shared Vitest setup (IMP-001). Registers jest-dom matchers on Vitest's
// expect (toBeInTheDocument, toHaveClass, …). No fixture network latency is
// involved: unit/component tests never touch the @/data async fetchers.
import '@testing-library/jest-dom/vitest';
