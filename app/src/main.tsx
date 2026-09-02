import { createRoot } from 'react-dom/client';

import { ConfigErrorScreen } from '@/components/ConfigErrorScreen';
import { validateStartupConfig } from '@/data/source';

import './index.css';

/**
 * IMP-014 — Validated bootstrap (OPS-ENV-06, MIG-DS-03/05).
 *
 * Startup configuration is validated BEFORE the application tree is
 * imported: an invalid VITE_DATA_SOURCE or incomplete supabase-mode
 * config fails closed with a visible, deterministic error screen — never
 * a blank page, a permanent spinner, or a silent fixture fallback. The
 * app modules are imported dynamically so a module-level adapter
 * selection can never throw an uncaught import error ahead of this
 * validation boundary.
 */
async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);

  try {
    validateStartupConfig();
  } catch (error) {
    root.render(<ConfigErrorScreen error={error} />);
    return;
  }

  const [{ BrowserRouter }, { AuthProvider }, { DemoStoreProvider }, { default: App }] =
    await Promise.all([
      import('react-router-dom'),
      import('@/data/auth'),
      import('@/data/store'),
      import('./App.tsx'),
    ]);

  root.render(
    <BrowserRouter>
      <AuthProvider>
        <DemoStoreProvider>
          <App />
        </DemoStoreProvider>
      </AuthProvider>
    </BrowserRouter>,
  );
}

void bootstrap();
