/**
 * IMP-014 — Fatal startup configuration screen (OPS-ENV-06, MIG-DS-03/05).
 *
 * Shown only when validateStartupConfig() fails at bootstrap: the app
 * fails VISIBLY and deterministically — never a blank page, never a
 * permanent spinner, never a silent fixture fallback. Intentionally
 * minimal (no app shell, no router, no data access).
 */

interface ConfigErrorScreenProps {
  error: unknown;
}

export function ConfigErrorScreen({ error }: ConfigErrorScreenProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="max-w-xl rounded-lg border border-critical/40 bg-white p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-critical">
          Configuration error
        </p>
        <h1 className="mt-2 font-display text-2xl text-ink">CAOS cannot start</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">{message}</p>
        <p className="mt-4 text-sm leading-relaxed text-ink/60">
          Set <code className="font-mono text-xs">VITE_DATA_SOURCE</code> to{' '}
          <code className="font-mono text-xs">fixture</code> (demo track) or{' '}
          <code className="font-mono text-xs">supabase</code> (with{' '}
          <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code>) and restart. See{' '}
          <code className="font-mono text-xs">.env.example</code>.
        </p>
      </div>
    </main>
  );
}
