/**
 * IMP-011 — Authentication context.
 *
 * Restores the session once on load, subscribes to auth-state changes with
 * exactly one subscription, and unsubscribes cleanly. Distinguishes
 * loading / authenticated / unauthenticated. Application state is NEVER the
 * security boundary — database authorization (RLS, IMP-012) is.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { AuthContext } from './auth-context';
import { authService } from './authService';
import type { AuthSnapshot } from './types';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ status: 'loading', user: null });

  useEffect(() => {
    let active = true;
    authService.restore().then((s) => {
      if (active) setSnapshot(s);
    });
    const unsubscribe = authService.onChange((s) => {
      if (active) setSnapshot(s);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ snapshot, service: authService }), [snapshot]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
