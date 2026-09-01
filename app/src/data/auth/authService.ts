/**
 * IMP-011 — Auth service: the authentication adapter behind the data layer.
 *
 * React components never touch Supabase directly; they use the AuthProvider
 * actions, which delegate here. Two implementations of one contract:
 *
 *   fixture   — demo track: a synthetic demo persona, always "authenticated"
 *               (the demo has no login surface; preserved unchanged).
 *   supabase  — real staff authentication via Supabase Auth (AUTH-02…11).
 *
 * No firm membership or role is read, asserted, or stored here (DEC-J:
 * authorization is the live FirmMembership lookup, IMP-012).
 */
import { DATA_SOURCE } from '@/lib/env';
import { getSupabaseClient } from '@/lib/supabaseClient';

import type {
  Assurance,
  AuthResult,
  AuthSnapshot,
  AuthUser,
  DataSource,
  MfaEnrollResult,
} from './types';

export interface AuthService {
  readonly mode: DataSource;
  restore(): Promise<AuthSnapshot>;
  onChange(listener: (snapshot: AuthSnapshot) => void): () => void;
  signInPassword(email: string, password: string): Promise<AuthResult>;
  signInMagicLink(email: string, redirectTo: string): Promise<AuthResult>;
  requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult>;
  updatePassword(newPassword: string): Promise<AuthResult>;
  getAssurance(): Promise<Assurance>;
  mfaEnrollTotp(): Promise<MfaEnrollResult>;
  mfaVerify(factorId: string, code: string): Promise<AuthResult>;
  mfaChallengeVerifiedFactor(code: string): Promise<AuthResult>;
  signOut(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Fixture implementation (demo track — unchanged behavior)
// ---------------------------------------------------------------------------

const DEMO_USER: AuthUser = { id: 'demo-fixture-user', email: 'demo@caos.fixture' };

const fixtureService: AuthService = {
  mode: 'fixture',
  restore: async () => ({ status: 'authenticated', user: DEMO_USER }),
  onChange: () => () => {},
  signInPassword: async () => ({ ok: true }),
  signInMagicLink: async () => ({ ok: true }),
  requestPasswordReset: async () => ({ ok: true }),
  updatePassword: async () => ({ ok: true }),
  getAssurance: async () => ({ aal: 'aal1', hasVerifiedTotpFactor: true }),
  mfaEnrollTotp: async () => ({ ok: true }),
  mfaVerify: async () => ({ ok: true }),
  mfaChallengeVerifiedFactor: async () => ({ ok: true }),
  signOut: async () => {},
};

// ---------------------------------------------------------------------------
// Supabase implementation (staff authentication)
// ---------------------------------------------------------------------------

function failure(error: { message?: string } | null, fallback: string): AuthResult {
  return { ok: false, error: error?.message ?? fallback };
}

const supabaseService: AuthService = {
  mode: 'supabase',

  async restore() {
    const { data } = await getSupabaseClient().auth.getSession();
    const u = data.session?.user;
    return u
      ? { status: 'authenticated', user: { id: u.id, email: u.email ?? '' } }
      : { status: 'unauthenticated', user: null };
  },

  onChange(listener) {
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      listener(
        u
          ? { status: 'authenticated', user: { id: u.id, email: u.email ?? '' } }
          : { status: 'unauthenticated', user: null },
      );
    });
    return () => data.subscription.unsubscribe();
  },

  async signInPassword(email, password) {
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    return error ? failure(error, 'Sign-in failed') : { ok: true };
  },

  async signInMagicLink(email, redirectTo) {
    // shouldCreateUser: false — staff onboarding is invitation-only (AUTH-03);
    // no open registration surface.
    const { error } = await getSupabaseClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    return error ? failure(error, 'Magic-link request failed') : { ok: true };
  },

  async requestPasswordReset(email, redirectTo) {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
    return error ? failure(error, 'Password-reset request failed') : { ok: true };
  },

  async updatePassword(newPassword) {
    const { error } = await getSupabaseClient().auth.updateUser({ password: newPassword });
    return error ? failure(error, 'Password update failed') : { ok: true };
  },

  async getAssurance() {
    const supabase = getSupabaseClient();
    const [{ data: aal }, { data: factors }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    const verified = (factors?.totp ?? []).some((f) => f.status === 'verified');
    return { aal: (aal?.currentLevel as Assurance['aal']) ?? null, hasVerifiedTotpFactor: verified };
  },

  async mfaEnrollTotp() {
    const { data, error } = await getSupabaseClient().auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) return failure(error, 'MFA enrolment failed');
    return { ok: true, factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
  },

  async mfaVerify(factorId, code) {
    const supabase = getSupabaseClient();
    const { data: challenge, error: cError } = await supabase.auth.mfa.challenge({ factorId });
    if (cError || !challenge) return failure(cError, 'MFA challenge failed');
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    return error ? failure(error, 'MFA verification failed') : { ok: true };
  },

  async mfaChallengeVerifiedFactor(code) {
    const { data: factors, error: lError } = await getSupabaseClient().auth.mfa.listFactors();
    if (lError) return failure(lError, 'MFA factor lookup failed');
    const factor = (factors?.totp ?? []).find((f) => f.status === 'verified');
    if (!factor) return { ok: false, error: 'No verified TOTP factor enrolled' };
    return this.mfaVerify(factor.id, code);
  },

  async signOut() {
    // Revokes the current session's refresh token (AUTH-05).
    await getSupabaseClient().auth.signOut();
  },
};

export const authService: AuthService = DATA_SOURCE === 'supabase' ? supabaseService : fixtureService;
