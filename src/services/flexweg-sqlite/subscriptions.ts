// Polling-based subscription helper. Firestore has push (`onSnapshot`)
// but the Flexweg SQLite API only exposes a `/version` poll endpoint.
// We hide that asymmetry behind the same `subscribe(cb): unsubscribe`
// contract used by the Firebase services.
//
// Design:
//   - Each subscribe call runs an initial fetch + emits to its callback.
//   - A SHARED global poller hits `/version` every POLL_INTERVAL_MS and
//     bumps a local `currentVersion` cache.
//   - When the version changes, EVERY registered subscriber re-runs
//     its fetch and emits. This is intentionally coarse (any write
//     invalidates every cached query) — for a Kanban with ~5 active
//     subscriptions and writes every few seconds at most, it's fine.
//     If we need finer invalidation later (per-table version columns),
//     we'd add server-side support first.
//   - The poller stops automatically when there are no active
//     subscribers, so an idle modal closes its CommentList sub and
//     traffic drops to zero.

import { sqlVersion, SqliteApiError } from "./client";

const POLL_INTERVAL_MS = 4000;

interface Subscriber<T> {
  fetch: () => Promise<T>;
  onChange: (data: T) => void;
  onError?: (err: Error) => void;
}

const subscribers = new Set<Subscriber<unknown>>();
let currentVersion: number | null = null;
let pollerTimer: ReturnType<typeof setInterval> | null = null;
let pollerInflight = false;

// Background poller. Runs `/version` and, when the version bumped,
// triggers all subscribers to refresh.
async function poll(): Promise<void> {
  if (pollerInflight) return;
  pollerInflight = true;
  try {
    const info = await sqlVersion();
    if (currentVersion === null) {
      // First successful poll establishes the baseline. Don't refresh
      // subscribers — they all just fetched as part of their subscribe
      // call. The next bump is what triggers a refresh.
      currentVersion = info.version;
      return;
    }
    if (info.version !== currentVersion) {
      currentVersion = info.version;
      // Snapshot the set in case a refresh callback subscribes /
      // unsubscribes during the loop.
      const snapshot = Array.from(subscribers);
      for (const sub of snapshot) {
        try {
          const data = await sub.fetch();
          sub.onChange(data);
        } catch (err) {
          if (sub.onError) sub.onError(err as Error);
        }
      }
    }
  } catch (err) {
    // Network blip or token expired — log once, the next poll retries.
    // For SqliteApiError 401/403 surface to subscribers so the UI can
    // react (revoked token = bandeau "session expired" or similar).
    if (err instanceof SqliteApiError && (err.status === 401 || err.status === 403)) {
      const snapshot = Array.from(subscribers);
      for (const sub of snapshot) {
        if (sub.onError) sub.onError(err);
      }
    }
    // Otherwise: swallow. The next poll will retry.
  } finally {
    pollerInflight = false;
  }
}

function startPoller(): void {
  if (pollerTimer !== null) return;
  // Kick off an immediate poll to establish currentVersion ASAP, then
  // schedule the regular cadence.
  poll();
  pollerTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPoller(): void {
  if (pollerTimer === null) return;
  clearInterval(pollerTimer);
  pollerTimer = null;
  currentVersion = null;
}

// Public API: register a (fetch, onChange) pair. Returns an unsub
// function. The initial fetch fires immediately and resolves the
// onChange callback before the poller engages.
//
// Errors from the initial fetch go to onError if provided, otherwise
// they're logged to the console — subscriptions never throw.
export function subscribeWithPolling<T>(
  fetch: () => Promise<T>,
  onChange: (data: T) => void,
  onError?: (err: Error) => void,
): () => void {
  const sub: Subscriber<T> = { fetch, onChange, onError };
  subscribers.add(sub as Subscriber<unknown>);
  startPoller();

  // Initial fetch. Must be async; we deliberately don't await the
  // returned promise from subscribe() since the contract is "fire
  // and forget — the callback is invoked when data arrives".
  fetch()
    .then(onChange)
    .catch((err) => {
      if (onError) onError(err as Error);
      else console.error("subscribeWithPolling initial fetch failed", err);
    });

  return () => {
    subscribers.delete(sub as Subscriber<unknown>);
    if (subscribers.size === 0) stopPoller();
  };
}

// Called by service writes to force a poll on the next tick. Optional
// optimisation — without it, writes are still picked up by the next
// scheduled poll (within POLL_INTERVAL_MS). With it, local writes
// reflect across other open tabs slightly faster.
export function notifyPotentialChange(): void {
  // Schedule a poll soon (not in this tick to coalesce bursts of
  // writes from batch operations).
  setTimeout(() => {
    poll();
  }, 50);
}
