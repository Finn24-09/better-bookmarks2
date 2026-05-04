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

/** Minimal logger shape — compatible with the fastify pino instance. */
export interface HealthLogger {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

/**
 * Scrub credential-bearing substrings from a thrown value before it is
 * passed to the logger, and bound the message length. The pg client and
 * libpq layers occasionally surface the full connection URI (with embedded
 * password) in their error messages; without this, anything reading
 * container stdout sees the secret in cleartext.
 */
function safeErr(err: unknown): { code?: string; errno?: string | number; message: string } {
  const e = err as { code?: unknown; errno?: unknown; message?: unknown };
  const raw = typeof e.message === 'string' ? e.message : String(err);
  const message = raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/password=[^\s&'"]+/gi, 'password=[redacted]')
    .slice(0, 500);
  return {
    code: typeof e.code === 'string' ? e.code.slice(0, 32) : undefined,
    errno: typeof e.errno === 'string' || typeof e.errno === 'number' ? e.errno : undefined,
    message,
  };
}

/**
 * Re-entrancy guard. With a 30 s cadence and a 5 s connect timeout this
 * is theoretical, but a slow query that exceeds the interval would let
 * two pings overlap and corrupt the wasOk snapshot semantics (double-log
 * recovery, miss recovery, etc.). One in-flight ping is enough.
 */
let pinging = false;

/**
 * Run a single SELECT 1 and update the cached state.
 *
 * When the optional logger is provided:
 * - Every failure is logged at warn level with `err.code` and `err.message`.
 *   Without this, container operators see only "/health → 503" in logs and
 *   cannot tell whether the DB is unreachable, the password is wrong, the
 *   role doesn't exist, or the connection URI failed to parse.
 * - The first success after a failure logs an info message so recovery is
 *   visible too.
 */
export async function pingDbOnce(logger?: HealthLogger): Promise<void> {
  if (pinging) return;
  pinging = true;
  try {
    const wasOk = dbHealth.ok;
    try {
      await pool.query('SELECT 1');
      dbHealth.ok = true;
      if (!wasOk && logger) {
        try {
          logger.info({}, 'db health: SELECT 1 succeeded, /health will return 200 (recovered)');
        } catch {
          /* logger must not break the loop */
        }
      }
    } catch (err) {
      dbHealth.ok = false;
      if (logger) {
        try {
          logger.warn(
            { err: safeErr(err) },
            'db health: SELECT 1 failed, /health will return 503',
          );
        } catch {
          /* logger must not break the loop */
        }
      }
    }
    dbHealth.lastCheck = Date.now();
  } finally {
    pinging = false;
  }
}

/** Start the background loop. Returns the timer so callers can clearInterval. */
export function startDbHealthLoop(logger?: HealthLogger): NodeJS.Timeout {
  // Fire-and-forget initial ping so the first /health call after startup
  // sees a fresh state, not the optimistic-default.
  void pingDbOnce(logger);
  const t = setInterval(() => {
    void pingDbOnce(logger);
  }, DB_PING_INTERVAL_MS);
  // Don't keep the event loop alive on this timer alone.
  if (typeof t.unref === 'function') t.unref();
  return t;
}
