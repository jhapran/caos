/**
 * IMP-062 — Limited Realtime (R1-B): channel-hub contract tests (network
 * mocked at the browser-client boundary).
 *
 * Pins the reviewed lifecycle contract:
 *   - EXACTLY ONE private channel per firm topic per client, shared by all
 *     consumers of the topic (Navbar badge + queue page); removed when the
 *     last listener releases;
 *   - invalidation-only: a broadcast fires the bare callback — the payload
 *     is NEVER surfaced to application code (SECURITY invariant);
 *   - duplicate events are harmless extra invalidations;
 *   - first SUBSCRIBED does not invalidate (the mount read is in flight);
 *     a re-SUBSCRIBED rejoin DOES invalidate once (API-RT-06 reconnect
 *     authoritative refresh; the fresh join re-authorized server-side);
 *   - authorization denial is TERMINAL: channel removed, topic marked
 *     terminal, NO further channel attempts (no infinite CHANNEL_ERROR
 *     retry — realtime-js would retry a live channel ~every 5 s forever);
 *   - non-authz errors get a BOUNDED retry (MAX_CHANNEL_ERRORS) then the
 *     same terminal removal; unclassifiable errors fail safe into the
 *     bounded budget; a successful SUBSCRIBED resets the budget;
 *   - explicit teardown on SIGNED_OUT and on identity/session change
 *     (load-bearing: the hosted spike proved signOut does NOT promptly
 *     kill an open channel); terminal marks clear so a fresh join under a
 *     new identity re-authorizes; same-user token refresh tears nothing
 *     down;
 *   - subscriptions-disabled configuration (TEST-API-09) opens no channel
 *     and tears open ones down; re-enabling re-joins live topics;
 *   - topic construction fails closed on a malformed firm id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockChannel {
  topic: string;
  config: unknown;
  handlers: { event: string; filter: Record<string, unknown>; cb: (msg?: unknown) => void }[];
  statusCb: ((status: string, err?: unknown) => void) | null;
  removed: boolean;
  obj: unknown;
  emit: (payload?: unknown) => void;
  driveStatus: (status: string, err?: unknown) => void;
}

const FIRM = 'a6200000-0000-4000-8000-0000000000aa';
const TOPIC = `firm:${FIRM}:review_queue`;
const ALERTS_TOPIC = `firm:${FIRM}:alerts`;

const channels: MockChannel[] = [];
let authListener: ((event: string, session: { user?: { id: string } } | null) => void) | null;
let authWatchCount = 0;

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    channel: (topic: string, config: unknown) => {
      const captured: MockChannel = {
        topic,
        config,
        handlers: [],
        statusCb: null,
        removed: false,
        obj: null,
        emit: (payload) => {
          for (const h of captured.handlers) {
            if (h.event === 'broadcast') h.cb(payload);
          }
        },
        driveStatus: (status, err) => captured.statusCb?.(status, err),
      };
      const channelObj = {
        on: (event: string, filter: Record<string, unknown>, cb: (msg?: unknown) => void) => {
          captured.handlers.push({ event, filter, cb });
          return channelObj;
        },
        subscribe: (cb: (status: string, err?: unknown) => void) => {
          captured.statusCb = cb;
          return channelObj;
        },
      };
      captured.obj = channelObj;
      channels.push(captured);
      return channelObj;
    },
    removeChannel: (channelObj: unknown) => {
      const captured = channels.find((c) => c.obj === channelObj);
      if (captured) captured.removed = true;
      return Promise.resolve('ok');
    },
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authListener = cb;
        authWatchCount += 1;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

import {
  acquireTopicListener,
  MAX_CHANNEL_ERRORS,
  resetRealtimeHubForTests,
  setRealtimeChannelsEnabled,
} from '@/data/realtime/hub';
import { firmSurfaceTopic } from '@/data/realtime/topics';

beforeEach(() => {
  channels.length = 0;
  authListener = null;
  authWatchCount = 0;
  resetRealtimeHubForTests();
});

afterEach(() => {
  resetRealtimeHubForTests();
});

describe('firmSurfaceTopic — fail-closed topic construction', () => {
  it('builds the reviewed private topics for canonical firm UUIDs', () => {
    expect(firmSurfaceTopic(FIRM, 'review_queue')).toBe(`firm:${FIRM}:review_queue`);
    expect(firmSurfaceTopic(FIRM, 'alerts')).toBe(`firm:${FIRM}:alerts`);
    expect(firmSurfaceTopic('A6200000-0000-4000-8000-0000000000AA', 'alerts')).toBe(
      'firm:A6200000-0000-4000-8000-0000000000AA:alerts',
    );
  });

  it('returns null (no channel) for malformed firm ids', () => {
    expect(firmSurfaceTopic('firm-1', 'review_queue')).toBeNull();
    expect(firmSurfaceTopic('', 'review_queue')).toBeNull();
    expect(firmSurfaceTopic(`${FIRM} `, 'review_queue')).toBeNull();
    expect(firmSurfaceTopic('zzzzzzzz-0000-4000-8000-0000000000aa', 'review_queue')).toBeNull();
  });
});

describe('realtime hub — shared channel lifecycle', () => {
  it('opens exactly ONE private channel per topic, shared by all consumers, removed at last release', () => {
    const release1 = acquireTopicListener(TOPIC, () => {});
    const release2 = acquireTopicListener(TOPIC, () => {});
    expect(channels).toHaveLength(1);
    expect(channels[0].topic).toBe(TOPIC);
    expect(channels[0].config).toEqual({ config: { private: true } });
    expect(channels[0].handlers[0]).toMatchObject({
      event: 'broadcast',
      filter: { event: 'invalidate' },
    });

    release1();
    expect(channels[0].removed).toBe(false); // a listener remains
    release2();
    expect(channels[0].removed).toBe(true); // last release tears the channel down

    // A later consumer gets a fresh channel (fresh join → reauthorization).
    const release3 = acquireTopicListener(TOPIC, () => {});
    expect(channels).toHaveLength(2);
    expect(channels[1].removed).toBe(false);
    release3();
    expect(channels[1].removed).toBe(true);
  });

  it('different surfaces of one firm get their own single channels', () => {
    const release1 = acquireTopicListener(TOPIC, () => {});
    const release2 = acquireTopicListener(ALERTS_TOPIC, () => {});
    expect(channels.map((c) => c.topic)).toEqual([TOPIC, ALERTS_TOPIC]);
    release1();
    release2();
  });

  it('the auth watch is registered once across many acquisitions', () => {
    const r1 = acquireTopicListener(TOPIC, () => {});
    const r2 = acquireTopicListener(ALERTS_TOPIC, () => {});
    expect(authWatchCount).toBe(1);
    r1();
    r2();
  });
});

describe('realtime hub — invalidation-only events (SECURITY invariant)', () => {
  it('a broadcast fires the bare callback on every listener and NEVER surfaces the payload', () => {
    const pageListener = vi.fn();
    const badgeListener = vi.fn();
    const release1 = acquireTopicListener(TOPIC, pageListener);
    const release2 = acquireTopicListener(TOPIC, badgeListener);

    channels[0].emit({ id: 'row-1', kind: 'review_queue.invalidate', firm_id: FIRM });
    expect(pageListener).toHaveBeenCalledTimes(1);
    expect(badgeListener).toHaveBeenCalledTimes(1);
    // The callback receives NOTHING — application code cannot read, apply,
    // or render payload content even by mistake.
    expect(pageListener.mock.calls[0]).toHaveLength(0);
    expect(badgeListener.mock.calls[0]).toHaveLength(0);

    release1();
    release2();
  });

  it('duplicate and repeated events are harmless extra bare invalidations', () => {
    const listener = vi.fn();
    const release = acquireTopicListener(TOPIC, listener);
    channels[0].emit({ id: 'row-1' });
    channels[0].emit({ id: 'row-1' }); // duplicate delivery (spike-observed)
    channels[0].emit({ id: 'row-1' }); // reordered/repeated — same shape
    expect(listener).toHaveBeenCalledTimes(3); // each collapses to a refetch
    release();
  });

  it('a listener that throws does not break the topic for other consumers', () => {
    const bad = vi.fn(() => {
      throw new Error('consumer bug');
    });
    const good = vi.fn();
    const release1 = acquireTopicListener(TOPIC, bad);
    const release2 = acquireTopicListener(TOPIC, good);
    channels[0].emit({});
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    release1();
    release2();
  });
});

describe('realtime hub — reconnect reauthorization + authoritative refetch (API-RT-06)', () => {
  it('the first SUBSCRIBED does not invalidate; a rejoin SUBSCRIBED invalidates once', () => {
    const listener = vi.fn();
    const release = acquireTopicListener(TOPIC, listener);

    channels[0].driveStatus('SUBSCRIBED'); // initial join — mount read already in flight
    expect(listener).not.toHaveBeenCalled();

    channels[0].driveStatus('SUBSCRIBED'); // rejoin after a drop — fresh join re-authorized
    expect(listener).toHaveBeenCalledTimes(1); // authoritative refetch before UI current

    channels[0].driveStatus('SUBSCRIBED');
    expect(listener).toHaveBeenCalledTimes(2);
    release();
  });
});

describe('realtime hub — authorization denial is TERMINAL (no infinite retry)', () => {
  it('an Unauthorized CHANNEL_ERROR removes the channel and blocks all further attempts', () => {
    const listener = vi.fn();
    const release1 = acquireTopicListener(TOPIC, listener);

    channels[0].driveStatus(
      'CHANNEL_ERROR',
      new Error(`Unauthorized: You do not have permissions to read from this Channel topic: ${TOPIC}`),
    );
    expect(channels[0].removed).toBe(true);

    // Terminal: a NEW consumer of the same topic opens NO new channel —
    // the topic runs on the polling fallback with zero contract change.
    const lateListener = vi.fn();
    const release2 = acquireTopicListener(TOPIC, lateListener);
    expect(channels).toHaveLength(1);

    release1();
    release2();
  });

  it('non-authz errors get a bounded retry, then the same terminal removal', () => {
    const listener = vi.fn();
    const release = acquireTopicListener(TOPIC, listener);

    for (let i = 1; i < MAX_CHANNEL_ERRORS; i += 1) {
      channels[0].driveStatus('CHANNEL_ERROR', new Error('connection refused'));
      expect(channels[0].removed).toBe(false); // realtime-js keeps its own retry alive
    }
    channels[0].driveStatus('TIMED_OUT', undefined); // unclassifiable → fails safe into the budget
    expect(channels[0].removed).toBe(true); // budget exhausted → terminal

    const late = acquireTopicListener(TOPIC, () => {});
    expect(channels).toHaveLength(1); // no further attempts
    release();
    late();
  });

  it('a successful SUBSCRIBED resets the non-authz error budget', () => {
    const release = acquireTopicListener(TOPIC, () => {});
    channels[0].driveStatus('CHANNEL_ERROR', new Error('connection refused'));
    channels[0].driveStatus('CHANNEL_ERROR', new Error('connection refused'));
    channels[0].driveStatus('SUBSCRIBED'); // recovered — budget resets
    channels[0].driveStatus('CHANNEL_ERROR', new Error('connection refused'));
    channels[0].driveStatus('CHANNEL_ERROR', new Error('connection refused'));
    expect(channels[0].removed).toBe(false); // still below the fresh budget
    channels[0].driveStatus('CHANNEL_ERROR', new Error('connection refused'));
    expect(channels[0].removed).toBe(true);
    release();
  });
});

describe('realtime hub — explicit teardown on logout / identity change (load-bearing)', () => {
  it('SIGNED_OUT tears down every open channel and clears terminal marks', () => {
    const release1 = acquireTopicListener(TOPIC, () => {});
    const release2 = acquireTopicListener(ALERTS_TOPIC, () => {});
    channels[0].driveStatus(
      'CHANNEL_ERROR',
      new Error('Unauthorized: You do not have permissions to read from this Channel topic'),
    );
    expect(channels[0].removed).toBe(true);
    expect(channels[1].removed).toBe(false);

    authListener?.('SIGNED_OUT', null);
    expect(channels[1].removed).toBe(true);

    // Terminal marks cleared: a fresh join under a new session re-authorizes.
    const release3 = acquireTopicListener(TOPIC, () => {});
    expect(channels).toHaveLength(3);
    expect(channels[2].removed).toBe(false);
    release1();
    release2();
    release3();
  });

  it('an identity/session change tears channels down; a same-user token refresh does not', () => {
    authListener?.('SIGNED_IN', { user: { id: 'user-1' } }); // establishes identity
    const release1 = acquireTopicListener(TOPIC, () => {});
    expect(channels[0].removed).toBe(false);

    authListener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } }); // same user — nothing to do
    expect(channels[0].removed).toBe(false);

    authListener?.('SIGNED_IN', { user: { id: 'user-2' } }); // identity changed → teardown
    expect(channels[0].removed).toBe(true);
    release1();
  });
});

describe('realtime hub — subscriptions-disabled configuration (TEST-API-09)', () => {
  it('disabled channels open nothing and tear down open channels; re-enabling re-joins live topics', () => {
    const release1 = acquireTopicListener(TOPIC, () => {});
    expect(channels).toHaveLength(1);

    setRealtimeChannelsEnabled(false);
    expect(channels[0].removed).toBe(true);

    const release2 = acquireTopicListener(ALERTS_TOPIC, () => {});
    expect(channels).toHaveLength(1); // nothing opened while disabled

    setRealtimeChannelsEnabled(true);
    expect(channels).toHaveLength(3); // both live topics re-joined
    expect(channels[1].topic).toBe(TOPIC);
    expect(channels[2].topic).toBe(ALERTS_TOPIC);

    release1();
    release2();
  });
});
