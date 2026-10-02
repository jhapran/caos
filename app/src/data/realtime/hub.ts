/**
 * IMP-062 — Limited Realtime (R1-B): the firm-topic channel hub.
 *
 * One PRIVATE broadcast channel per firm topic per browser client, shared
 * by every mounted consumer of that topic (the Review Queue page and the
 * Navbar badge both listen on firm:<id>:review_queue — the reviewed
 * contract requires EXACTLY ONE channel per topic per client; a second
 * same-topic channel can hang the realtime-js subscribe callback).
 *
 * Channel semantics (all spike-proven, all load-bearing):
 *
 *   * Events are INVALIDATIONS ONLY. The broadcast payload is never read,
 *     never applied, never rendered — each event collapses to the bare
 *     onInvalidate callback, whose contract is "re-read through the normal
 *     RLS-controlled @/data read" (API-RT-03/05). Missed, duplicate,
 *     reordered and repeated events are therefore harmless.
 *
 *   * Authorization denial is TERMINAL (reviewed contract): the platform
 *     answers a denied join with CHANNEL_ERROR "Unauthorized…" and
 *     realtime-js would retry it ~every 5 s FOREVER. The hub removes the
 *     channel on the first authorization-shaped denial and marks the topic
 *     terminal — consumers continue on the always-on polling fallback with
 *     zero contract change (API-RT-07). No infinite CHANNEL_ERROR loop.
 *
 *   * Non-authorization channel errors get a BOUNDED retry: realtime-js's
 *     own rejoin attempts continue until MAX_CHANNEL_ERRORS consecutive
 *     failures, then the channel is removed and the topic goes terminal
 *     (polling fallback again). Classification fails safe: an
 *     unclassifiable error is treated as non-authz and still ends terminal
 *     after the bound.
 *
 *   * Reconnect re-authorizes and re-fetches (API-RT-06): a rejoin is a
 *     fresh join, so the server re-evaluates realtime.messages RLS; on a
 *     re-SUBSCRIBED after a previous subscription the hub fires one
 *     invalidation so consumers perform the authoritative refetch before
 *     the UI is treated as current. The first SUBSCRIBED after mount does
 *     NOT fire (the consumer's own initial read is already in flight).
 *
 *   * Explicit teardown is LOAD-BEARING (hosted spike: signOut does NOT
 *     promptly kill an open channel — deliveries observed at +2/+8/+20 s,
 *     bounded only by the access-token TTL). The hub therefore watches the
 *     auth state through the existing adapter-path client and tears down
 *     EVERY channel on logout and on identity/session change. Teardown
 *     also clears terminal marks so a fresh join under a new identity
 *     re-authorizes cleanly. Consumer unmount releases listeners; the
 *     channel is removed when the last listener of a topic releases.
 *
 * The hub never decides authorization: join denial, message visibility and
 * every authoritative re-read are enforced server-side (realtime.messages
 * RLS + app-table RLS). Fixture mode never reaches this module (the
 * fixture adapters simulate locally, API-RT-04) and getSupabaseClient()
 * itself throws outside supabase mode (MIG-DS-06).
 */
import type { AuthChangeEvent, RealtimeChannel, Session } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabaseClient';

/** Bounded non-authz retry budget per topic (implementation parameter,
 *  NOT a product SLA — same status as the 15 s polling interval). */
export const MAX_CHANNEL_ERRORS = 3;

interface HubEntry {
  readonly topic: string;
  channel: RealtimeChannel | null;
  readonly listeners: Set<() => void>;
  /** True after the first SUBSCRIBED — a later SUBSCRIBED is a rejoin. */
  wasSubscribed: boolean;
  consecutiveErrors: number;
  /** Terminal for this session: no further channel attempts (polling only). */
  terminal: boolean;
}

const entries = new Map<string, HubEntry>();

/** Subscriptions-disabled configuration (TEST-API-09): with channels off,
 *  the exact same invalidation contract runs on polling alone. Default on. */
let channelsEnabled = true;

let authWatchStop: (() => void) | null = null;
let lastUserId: string | null = null;

/** The platform's uniform fail-closed join denial (spike-proven shape):
 *  "Unauthorized: You do not have permissions to read from this Channel
 *  topic: …". Matched narrowly and case-insensitively; anything else is a
 *  transient error under the bounded-retry budget. */
function isAuthorizationDenial(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? '');
  return /unauthor/i.test(message);
}

function notify(entry: HubEntry): void {
  for (const listener of [...entry.listeners]) {
    try {
      listener();
    } catch {
      // A consumer failure must not break the other consumers of the topic.
    }
  }
}

function removeEntryChannel(entry: HubEntry): void {
  const channel = entry.channel;
  entry.channel = null;
  entry.wasSubscribed = false;
  entry.consecutiveErrors = 0;
  if (channel) {
    void getSupabaseClient()
      .removeChannel(channel)
      .catch(() => {
        // Removal is best-effort hygiene; the channel is dead either way.
      });
  }
}

/** Tear down EVERY open channel (logout / identity / session change) and
 *  clear terminal marks so a later fresh join re-authorizes. Listeners
 *  stay registered — they keep their polling fallback and re-join on their
 *  next acquire (in practice the identity-bound bootstrap unmounts them). */
function teardownAllChannels(): void {
  for (const entry of entries.values()) {
    removeEntryChannel(entry);
    entry.terminal = false;
  }
}

function onAuthEvent(event: AuthChangeEvent, session: Session | null): void {
  const userId = session?.user?.id ?? null;
  const identityChanged = lastUserId !== null && userId !== lastUserId;
  if (event === 'SIGNED_OUT' || identityChanged) {
    // Hosted proof (spike P1): the platform does NOT promptly terminate an
    // open channel on signOut — explicit teardown here is the control.
    teardownAllChannels();
  }
  lastUserId = userId;
}

/** One module-lifetime auth watch, registered lazily on first use so
 *  fixture mode and channel-free sessions never touch the auth API. */
function ensureAuthWatch(): void {
  if (authWatchStop) return;
  const { data } = getSupabaseClient().auth.onAuthStateChange(onAuthEvent);
  authWatchStop = () => data.subscription.unsubscribe();
}

function openChannel(entry: HubEntry): void {
  const client = getSupabaseClient();
  const channel = client.channel(entry.topic, { config: { private: true } });
  entry.channel = channel;
  // The payload is deliberately never surfaced: the callback takes no
  // argument, so application code CANNOT render state from a broadcast.
  channel.on('broadcast', { event: 'invalidate' }, () => notify(entry));
  channel.subscribe((status, err) => {
    if (entry.channel !== channel) return; // stale callback from a dead channel
    if (status === 'SUBSCRIBED') {
      if (entry.wasSubscribed) {
        // Rejoin after a drop: the fresh join re-authorized server-side;
        // force the authoritative refetch (API-RT-06).
        notify(entry);
      }
      entry.wasSubscribed = true;
      entry.consecutiveErrors = 0;
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      if (isAuthorizationDenial(err)) {
        entry.terminal = true; // authz denial is TERMINAL — never retried
        removeEntryChannel(entry);
        return;
      }
      entry.consecutiveErrors += 1;
      if (entry.consecutiveErrors >= MAX_CHANNEL_ERRORS) {
        entry.terminal = true; // bounded non-authz retry exhausted → polling
        removeEntryChannel(entry);
      }
    }
  });
}

/** Register one invalidation listener on a firm topic, opening the shared
 *  private channel when needed. Returns the release function; the channel
 *  is removed when the topic's last listener releases. */
export function acquireTopicListener(topic: string, onInvalidate: () => void): () => void {
  let entry = entries.get(topic);
  if (!entry) {
    entry = {
      topic,
      channel: null,
      listeners: new Set(),
      wasSubscribed: false,
      consecutiveErrors: 0,
      terminal: false,
    };
    entries.set(topic, entry);
  }
  entry.listeners.add(onInvalidate);
  ensureAuthWatch();
  if (channelsEnabled && !entry.terminal && !entry.channel) {
    openChannel(entry);
  }
  return () => {
    const current = entries.get(topic);
    if (!current) return;
    current.listeners.delete(onInvalidate);
    if (current.listeners.size === 0) {
      removeEntryChannel(current);
      entries.delete(topic);
    }
  };
}

/** Subscriptions-disabled configuration (TEST-API-09: the same workflows
 *  must be correct with realtime subscriptions disabled). Disabling tears
 *  down every open channel; enabling re-opens channels for topics that
 *  still have live listeners. */
export function setRealtimeChannelsEnabled(enabled: boolean): void {
  channelsEnabled = enabled;
  if (!enabled) {
    teardownAllChannels();
    return;
  }
  for (const entry of entries.values()) {
    if (entry.listeners.size > 0 && !entry.terminal && !entry.channel) {
      openChannel(entry);
    }
  }
}

/** Test-only module reset: removes every channel and listener and
 *  restores defaults. Production code never calls this. */
export function resetRealtimeHubForTests(): void {
  for (const entry of entries.values()) {
    removeEntryChannel(entry);
  }
  entries.clear();
  channelsEnabled = true;
  lastUserId = null;
  if (authWatchStop) {
    authWatchStop();
    authWatchStop = null;
  }
}
