import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // IMP-001 harness: unit/component tests live in tests/{unit,components}
  // (jsdom, no network). Integration tests live in tests/integration/ and run
  // via vitest.integration.config.ts (node, local Supabase). E2E lives in
  // e2e/ via Playwright (playwright.config.ts).
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/{unit,components}/**/*.test.{ts,tsx}'],
    css: false,
  },
});
