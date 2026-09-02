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
    // IMP-014: pins VITE_DATA_SOURCE=supabase + local-stack client-safe
    // config for adapter modules imported from src/.
    setupFiles: ['tests/integration/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Integration tests share local Supabase state — files must run
    // strictly sequentially (fixtures create/delete the same rows).
    // fileParallelism: false is the Vitest 4 switch; a bare
    // `forks: { singleFork: true }` key is silently ignored and left
    // files racing each other's fixtures.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
