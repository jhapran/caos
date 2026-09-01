/**
 * IMP-011 — Authentication-level route protection.
 *
 * Fixture mode: passthrough (demo track unchanged).
 * Supabase mode: unauthenticated users are redirected to staff sign-in.
 *
 * This is AUTHENTICATION only. It makes no tenant/role decisions — no
 * membership data is consulted here and the frontend guard is never the
 * authorization boundary (DEC-J: live FirmMembership lookup + RLS,
 * IMP-012).
 *
 * MFA gate (AUTH-10 client-side stub): after authentication, staff with no
 * verified TOTP factor are sent to enrolment; staff at AAL1 with a
 * verified factor are sent to the challenge. Database AAL2 enforcement of
 * sensitive operations lands with IMP-012 (RLS-AAL-01).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/data/auth';
import type { Assurance } from '@/data/auth';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { snapshot, service } = useAuth();
  const location = useLocation();
  const [assurance, setAssurance] = useState<Assurance | 'loading'>('loading');

  const checkMfa = service.mode === 'supabase' && snapshot.status === 'authenticated';

  useEffect(() => {
    if (!checkMfa) return;
    let active = true;
    service.getAssurance().then((a) => {
      if (active) setAssurance(a);
    });
    return () => {
      active = false;
    };
  }, [checkMfa, service, snapshot.user?.id]);

  if (service.mode === 'fixture') return <>{children}</>;

  if (snapshot.status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-paper">Loading…</div>;
  }
  if (snapshot.status === 'unauthenticated') {
    return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (assurance === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-paper">Loading…</div>;
  }
  if (!assurance.hasVerifiedTotpFactor) {
    return <Navigate to="/auth/mfa-enroll" replace />;
  }
  if (assurance.aal === 'aal1') {
    return <Navigate to="/auth/mfa-challenge" replace />;
  }

  return <>{children}</>;
}
