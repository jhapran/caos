/**
 * Staging UI truthfulness closure — real shell identity for Supabase mode.
 *
 * The app shell (sidebar firm card, user chip, topbar avatar) must never
 * present fixture FIRM/team records as live data in Supabase mode. This
 * hook resolves the REAL signed-in identity through the @/data tenancy
 * boundary: own profile display name + the caller's live membership in
 * the current active firm (RLS-CTX: context, never authority).
 *
 * Fixture mode returns null — the demo shell keeps its seeded FIRM
 * presentation unchanged.
 */
import { useEffect, useState } from 'react';

import { useAuth } from '@/data/auth';
import { getActiveFirm, tenancyService } from '@/data';
import type { MembershipRole } from '@/data';

export interface ShellIdentity {
  fullName: string;
  firmName: string | null;
  role: MembershipRole | null;
}

export function useShellIdentity(): ShellIdentity | null {
  const { snapshot, service } = useAuth();
  const supabaseAuthed = service.mode === 'supabase' && snapshot.status === 'authenticated';
  const userId = snapshot.user?.id ?? null;
  const email = snapshot.user?.email ?? null;
  // Keyed by the user id the identity was resolved FOR, so a stale identity
  // can never render for a different signed-in user (same identity-binding
  // discipline as RequireAuth's active-firm bootstrap).
  const [resolved, setResolved] = useState<{ forUser: string; value: ShellIdentity } | null>(null);

  useEffect(() => {
    if (!supabaseAuthed || !userId) return;
    let active = true;
    Promise.all([tenancyService.getMyProfile(), tenancyService.listMyMemberships()])
      .then(([profile, memberships]) => {
        if (!active) return;
        const firmId = getActiveFirm();
        const membership =
          memberships.find((m) => m.firmId === firmId && m.status === 'active') ?? null;
        setResolved({
          forUser: userId,
          value: {
            fullName: profile?.fullName ?? email ?? 'Signed-in user',
            firmName: membership?.firmName ?? null,
            role: membership?.role ?? null,
          },
        });
      })
      .catch(() => {
        // Fail honest: identity falls back to the auth email, no fabricated
        // firm/role. RLS already gates the data itself.
        if (active) {
          setResolved({
            forUser: userId,
            value: { fullName: email ?? 'Signed-in user', firmName: null, role: null },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [supabaseAuthed, userId, email]);

  if (!supabaseAuthed || !userId) return null;
  return resolved?.forUser === userId ? resolved.value : null;
}
