/**
 * IMP-011 — Password reset request (AUTH-06). Single-use, time-limited
 * email link via Supabase Auth; existing sessions are revoked after reset.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/data/auth';

export default function ForgotPassword() {
  const { service } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await service.requestPasswordReset(
      email,
      `${window.location.origin}/auth/reset-password`,
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Password-reset request failed');
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Reset password</CardTitle>
          <CardDescription>We email you a single-use reset link.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-success">
              If this email is registered, a reset link is on its way.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error ? <p className="text-sm text-critical">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                Send reset link
              </Button>
            </form>
          )}
          <p className="mt-4 text-sm">
            <Link to="/auth/sign-in" className="text-brand hover:underline">
              Back to sign-in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
