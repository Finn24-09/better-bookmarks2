import { pool } from './db.js';

// M-3: /health used to call pool.query('SELECT 1') on every probe. That made
// every healthcheck request a DB oracle for unauthenticated callers — they
// could flood /health to amplify DB load (denial-of-wallet) and time the
// response to confirm DB reachability for an in-progress attack.
//
// Instead, /health now serves a cached boolean updated by a 30-second
// in-process ping. The probe response is constant-time and DB-free.
// A separate (unexposed-by-default) deep-health endpoint can be wired in
// later if Kubernetes-style readiness probing wants stronger semantics.

export const dbHealth = {
  /** Cached liveness flag updated by pingDbOnce(). Optimistic at boot
   *  so the first probe does not falsely report unhealthy before the
   *  first scheduled ping has had a chance to run. */
  ok: true as boolean,
  /** ms-epoch of the last successful or failed ping. */
  lastCheck: 0 as number,
};

export const DB_PING_INTERVAL_MS = 30_000;

/** Run a single SELECT 1 and update the cached state. */
export async function pingDbOnce(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    dbHealth.ok = true;
  } catch {
    dbHealth.ok = false;
  }
  dbHealth.lastCheck = Date.now();
}

/** Start the background loop. Returns the timer so callers can clearInterval. */
export function startDbHealthLoop(): NodeJS.Timeout {
  // Fire-and-forget initial ping so the first /health call after startup
  // sees a fresh state, not the optimistic-default.
  void pingDbOnce();
  const t = setInterval(() => {
    void pingDbOnce();
  }, DB_PING_INTERVAL_MS);
  // Don't keep the event loop alive on this timer alone.
  if (typeof t.unref === 'function') t.unref();
  return t;
}
