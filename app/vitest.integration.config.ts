import path from "path"
import { defineConfig } from "vitest/config"

// Harness Gate: database/Auth integration tests (node environment).
// These tests talk to the LOCAL Supabase stack (loopback-only) and require
// `npm run db:start` + `npm run db:reset:harness` first. They are kept
// separate from the jsdom unit/component tests (vite.config.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Integration tests share local Supabase state — run sequentially.
    pool: 'forks',
    forks: { singleFork: true },
  },
});
