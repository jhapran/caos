// Tiny mutable demo store (React context) so actions like approve / return /
// send-reminder / acknowledge update counts app-wide. Seeded from fixtures;
// resetDemo() restores the seed state.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ALERTS } from './alerts';
import { CLIENTS, ownerOf } from './clients';
import { DEPENDENCY_CLIENTS } from './dependency';
import { REVIEW_ITEMS } from './review';
import { AGGREGATES, TASKS } from './tasks';
import type { DependencyClient, FirmAlert, Reminder, ReviewItem, ReviewStatus } from './types';

export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'info' | 'warning' | 'critical';
}

interface ReviewOverlay {
  status: ReviewStatus;
  comments: ReviewItem['comments'];
}

interface DemoState {
  reviewOverlay: Record<string, ReviewOverlay>;
  reminders: Record<string, Reminder[]>;
  alertOverlay: Record<string, FirmAlert['status']>;
  toasts: Toast[];
}

interface DemoStore extends DemoState {
  reviewItems: ReviewItem[];
  reviewPendingCount: number;
  alerts: FirmAlert[];
  activeAlertCount: number;
  dependencyClients: DependencyClient[];
  approveReviewItem: (id: string, comment?: string) => void;
  returnReviewItem: (id: string, comment: string) => void;
  sendReminder: (clientId: string, channel?: Reminder['channel']) => void;
  acknowledgeAlert: (id: string) => void;
  resolveAlert: (id: string) => void;
  notify: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  resetDemo: () => void;
}

const DemoContext = createContext<DemoStore | null>(null);

let toastSeq = 1;

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>({
    reviewOverlay: {},
    reminders: {},
    alertOverlay: {},
    toasts: [],
  });

  const notify = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = toastSeq++;
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, message, kind }] }));
    window.setTimeout(() => {
      setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
  }, []);

  const approveReviewItem = useCallback((id: string, comment?: string) => {
    setState((s) => {
      const prev = s.reviewOverlay[id];
      const base = REVIEW_ITEMS.find((r) => r.id === id);
      const comments = [...(prev?.comments ?? base?.comments ?? [])];
      if (comment) {
        comments.push({ at: new Date().toISOString(), by: 'CA Lew Kong', text: comment });
      }
      return { ...s, reviewOverlay: { ...s.reviewOverlay, [id]: { status: 'approved', comments } } };
    });
  }, []);

  const returnReviewItem = useCallback((id: string, comment: string) => {
    setState((s) => {
      const prev = s.reviewOverlay[id];
      const base = REVIEW_ITEMS.find((r) => r.id === id);
      const comments = [...(prev?.comments ?? base?.comments ?? [])];
      comments.push({ at: new Date().toISOString(), by: 'CA Lew Kong', text: comment || 'Returned for rework.' });
      return { ...s, reviewOverlay: { ...s.reviewOverlay, [id]: { status: 'returned', comments } } };
    });
  }, []);

  const sendReminder = useCallback((clientId: string, channel: Reminder['channel'] = 'Email') => {
    const client = CLIENTS.find((c) => c.id === clientId);
    const name = client?.name ?? DEPENDENCY_CLIENTS.find((d) => d.clientId === clientId)?.clientName ?? 'client';
    const reminder: Reminder = {
      sentAt: new Date().toISOString(),
      channel,
      by: 'CA Lew Kong',
    };
    setState((s) => ({
      ...s,
      reminders: { ...s.reminders, [clientId]: [...(s.reminders[clientId] ?? []), reminder] },
    }));
    notify(`Reminder sent to ${name}`, 'success');
  }, [notify]);

  const acknowledgeAlert = useCallback((id: string) => {
    setState((s) => ({ ...s, alertOverlay: { ...s.alertOverlay, [id]: 'acknowledged' } }));
  }, []);

  const resolveAlert = useCallback((id: string) => {
    setState((s) => ({ ...s, alertOverlay: { ...s.alertOverlay, [id]: 'resolved' } }));
    notify('Alert marked resolved', 'success');
  }, [notify]);

  const resetDemo = useCallback(() => {
    setState({ reviewOverlay: {}, reminders: {}, alertOverlay: {}, toasts: [] });
    notify('Demo data reset to seed state', 'info');
  }, [notify]);

  const value = useMemo<DemoStore>(() => {
    const reviewItems = REVIEW_ITEMS.map((r) => {
      const o = state.reviewOverlay[r.id];
      return o ? { ...r, status: o.status, comments: o.comments } : r;
    });
    const alerts = ALERTS.map((a) => ({ ...a, status: state.alertOverlay[a.id] ?? a.status }));
    const dependencyClients = DEPENDENCY_CLIENTS.map((d) => {
      const extra = state.reminders[d.clientId];
      return extra && extra.length > 0 ? { ...d, lastReminderAt: extra[extra.length - 1].sentAt } : d;
    });
    return {
      ...state,
      reviewItems,
      reviewPendingCount: reviewItems.filter((r) => r.status === 'pending').length,
      alerts,
      activeAlertCount: alerts.filter((a) => a.status === 'active').length,
      dependencyClients,
      approveReviewItem,
      returnReviewItem,
      sendReminder,
      acknowledgeAlert,
      resolveAlert,
      notify,
      dismissToast,
      resetDemo,
    };
  }, [state, approveReviewItem, returnReviewItem, sendReminder, acknowledgeAlert, resolveAlert, notify, dismissToast, resetDemo]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoStore(): DemoStore {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemoStore must be used within <DemoStoreProvider>');
  return ctx;
}

/** Aggregates with live review/alert counts merged in. */
export function useLiveAggregates() {
  const { reviewPendingCount, activeAlertCount } = useDemoStore();
  return {
    ...AGGREGATES,
    totalTasks: TASKS.length,
    clients: CLIENTS.length,
    reviewPending: reviewPendingCount,
    alertsActive: activeAlertCount,
    dependencyClients: DEPENDENCY_CLIENTS.length,
    dependencyTasks: DEPENDENCY_CLIENTS.reduce((s, c) => s + c.blockingTasks, 0),
  };
}

export { ownerOf };
