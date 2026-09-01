/**
 * IMP-011 — Staff sign-in (AUTH-02/04): email/password or magic link.
 * Invitation-only onboarding (AUTH-03): there is no self-service sign-up.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/data/auth';

export default function SignIn() {
  const { service } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPasswordSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await service.signInPassword(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Sign-in failed');
      return;
    }
    navigate('/brief', { replace: true });
  }

  async function onMagicLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await service.signInMagicLink(email, `${window.location.origin}/brief`);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Magic-link request failed');
      return;
    }
    setNotice('If this email is registered, a sign-in link is on its way.');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">CAOS</CardTitle>
          <CardDescription>Staff sign-in. Access is by invitation only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={onPasswordSignIn} className="space-y-4">
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-critical">{error}</p> : null}
            {notice ? <p className="text-sm text-success">{notice}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              Sign in
            </Button>
          </form>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-brand hover:underline"
              disabled={busy || !email}
              onClick={onMagicLink}
            >
              Email me a magic link
            </button>
            <Link to="/auth/forgot-password" className="text-brand hover:underline">
              Forgot password?
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
