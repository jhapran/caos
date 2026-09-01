/**
 * IMP-011 — TOTP MFA challenge (AUTH-09): upgrades an AAL1 session to AAL2
 * for users who already hold a verified factor.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/data/auth';

export default function MfaChallenge() {
  const { service } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await service.mfaChallengeVerifiedFactor(code);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Verification failed');
      return;
    }
    navigate('/brief', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Two-factor authentication</CardTitle>
          <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Authenticator code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-critical">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
