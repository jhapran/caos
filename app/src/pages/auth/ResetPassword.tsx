/**
 * IMP-011 — Set a new password after a recovery link (AUTH-06). The
 * recovery session is established from the emailed link (detectSessionInUrl).
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/data/auth';

export default function ResetPassword() {
  const { service } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await service.updatePassword(password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Password update failed');
      return;
    }
    navigate('/auth/sign-in', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Choose a new password</CardTitle>
          <CardDescription>Existing sessions are revoked after a reset.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-critical">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              Update password
            </Button>
          </form>
          <p className="text-sm">
            <Link to="/auth/sign-in" className="text-brand hover:underline">
              Back to sign-in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
