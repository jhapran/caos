/**
 * IMP-011 — Authentication-level route protection.
 *
 * Fixture mode: passthrough (demo track unchanged).
 * Supabase mode: unauthenticated users are redirected to staff sign-in.
 *
 * This is AUTHENTICATION only. It makes no tenant/role decisions — the
 * frontend guard is never the authorization boundary (DEC-J: live
 * FirmMembership lookup + RLS, IMP-012).
 *
 * MFA gate (AUTH-10 client-side stub): after authentication, staff with no
 * verified TOTP factor are sent to enrolment; staff at AAL1 with a
 * verified factor are sent to the challenge. Database AAL2 enforcement of
 * sensitive operations lands with IMP-012 (RLS-AAL-01).
 *
 * IMP-022 closure — Identity-bound active-firm bootstrap (RLS-CTX-01/02):
 * after authentication and before any page renders, resolve the single
 * active-firm context through resolveDefaultActiveFirm() (deterministic
 * temporary R0 default; switcher UI is a later package). The resolution
 * is bound to the CURRENT auth identity: on logout, sign-in as a
 * different user, or session replacement, any previously resolved firm is
 * cleared BEFORE the new identity's protected pages render — stale
 * context can never carry across identities. Zero active memberships
 * leave the context empty (authorized-empty pages; writes fail closed).
 * Context is selection, never authorization: the database re-validates
 * the header against the live membership on every request.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/data/auth';
import type { Assurance } from '@/data/auth';
import {
  clearActiveFirm,
  resolveDefaultActiveFirm,
  setActiveFirm,
  tenancyService,
} from '@/data';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { snapshot, service } = useAuth();
  const location = useLocation();
  const [assurance, setAssurance] = useState<Assurance | 'loading'>('loading');
  // The auth user id the current firm context was resolved FOR. A
  // mismatch with the live identity means the context is stale.
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);

  const userId = snapshot.user?.id ?? null;
  const checkMfa = service.mode === 'supabase' && snapshot.status === 'authenticated';
  // Derived, no state needed: fixture mode is context-free, and a context
  // resolved for the live identity is ready (react-hooks/set-state-in-effect).
  const firmResolved = !checkMfa || (userId !== null && resolvedFor === userId);

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

  // Identity lifecycle: logout (or session expiry) drops the context
  // immediately. clearActiveFirm is module state, not React state, so
  // this effect needs no setState.
  useEffect(() => {
    if (snapshot.status === 'unauthenticated') clearActiveFirm();
  }, [snapshot.status]);

  // Bootstrap / re-resolution: runs whenever the live identity differs
  // from the identity the context was resolved for (first login, logout →
  // login as another user, session replacement without a hard refresh).
  useEffect(() => {
    if (!checkMfa || userId === null || resolvedFor === userId) return;
    // Identity changed — drop any stale context from the previous
    // identity BEFORE this identity's pages can render.
    clearActiveFirm();
    let active = true;
    tenancyService
      .listMyMemberships()
      .then((memberships) => {
        if (!active) return;
        const firm = resolveDefaultActiveFirm(memberships);
        setActiveFirm(firm);
        setResolvedFor(userId);
      })
      .catch(() => {
        // Fail closed: leave the context empty; pages surface their own
        // deterministic states and writes are refused client-side.
        if (active) setResolvedFor(userId);
      });
    return () => {
      active = false;
    };
  }, [checkMfa, userId, resolvedFor]);

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

  if (!firmResolved) {
    return <div className="flex min-h-screen items-center justify-center bg-paper">Loading…</div>;
  }

  return <>{children}</>;
}
