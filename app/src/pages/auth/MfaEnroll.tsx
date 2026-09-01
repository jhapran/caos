/**
 * IMP-011 — TOTP MFA enrolment (AUTH-09/10). Mandatory for all staff:
 * users without a verified factor land here after sign-in (client-side
 * gate; database AAL2 enforcement lands with IMP-012 per RLS-AAL-01).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/data/auth';

export default function MfaEnroll() {
  const { service } = useAuth();
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    service.mfaEnrollTotp().then((res) => {
      if (!res.ok) {
        setError(res.error ?? 'MFA enrolment failed');
        return;
      }
      setFactorId(res.factorId ?? null);
      setSecret(res.secret ?? null);
    });
  }, [service]);

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const res = await service.mfaVerify(factorId, code);
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
          <CardTitle className="font-display text-2xl">Set up two-factor authentication</CardTitle>
          <CardDescription>
            Required for all staff. Add this secret to your authenticator app, then enter the
            6-digit code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {secret ? (
            <p className="mb-4 break-all rounded-md bg-muted p-3 font-mono text-sm">{secret}</p>
          ) : null}
          <form onSubmit={onVerify} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={busy || !factorId}>
              Verify and continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
