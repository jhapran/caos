/**
 * Staging UI truthfulness closure — Supabase-mode module gate.
 *
 * Fixture/demo pages whose production module has not landed (Morning
 * Brief, Command Centre, Deadlines, Review Queue, Client Dependency,
 * Risk Alerts, Ask CAOS, Reports) must never present seeded demo records
 * as live hosted data in Supabase mode. This gate renders the fixture
 * page unchanged in fixture mode and an honest deferred state in
 * Supabase mode. It implements nothing of the deferred module itself.
 *
 * Follows the same deferred-state pattern approved for the Client 360
 * future tabs (IMP-022).
 */
import type { ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';

import { useAuth } from '@/data/auth';
import EmptyState from './EmptyState';

export default function ModuleGate({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  const { service } = useAuth();
  if (service.mode === 'fixture') return <>{children}</>;
  return (
    <div className="py-16">
      <EmptyState
        icon={CalendarClock}
        title={`${title} — coming in a later release`}
        description={detail}
      />
    </div>
  );
}
