import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions, RateLimitPluginOptions } from '@fastify/rate-limit';

// H-2: In-service rate limiting.
//
// Nginx ALSO applies rate limits, but Nginx is a single point of failure:
// a misconfiguration or bypass leaves every unauthenticated route
// unbounded. This module gives the email service its own caps so that
// even if Nginx is removed or routes around, the brute-force surface
// stays narrow.
//
// Per-route limits are based on the security review:
//   - /request-reset:           5  req / IP   / 60s   (enumeration / spam)
//   - /verify-email:            30 req / IP   / 60s
//   - /reset-password:          30 req / IP   / 60s
//   - /confirm-reset:           30 req / IP   / 60s
//   - /confirm-delete:           5 req / IP   / 60s   (password brute-force)
//   - /resend-verification:    10 req / user / 5 min (mail-bomb primitive)
//   - /request-delete:         10 req / user / 5 min
//   - /notify-password-change: 10 req / user / 5 min
//   - /refresh-after-verify:    3 req / user / 60s   (one-shot per verify event)
//   - /health:                  60 req / IP  / 60s   (generous, but bounded)

/**
 * Key authenticated routes by JWT `sub` (user id) when present, falling
 * back to remote IP. Authenticated routes that omit this fallback would
 * become free-for-all when the token is missing.
 *
 * Trust caveat: the JWT payload is parsed WITHOUT signature verification —
 * the verifier on the route itself enforces auth, this is purely a
 * rate-limit key. An attacker forging arbitrary `sub` values in
 * JWT-shaped strings can rotate buckets to sidestep IP-based caps. Blast
 * radius is bounded by (a) the per-route caps being tight (3-10 req/min),
 * (b) the route's own jose verifyJwt rejecting the forged token before
 * any side-effect, and (c) Nginx applying its own per-IP cap as a
 * defence-in-depth layer ahead of this. Do NOT extend any trust beyond
 * "this string is a Base64-decodable thing" to the parsed payload.
 */
function userOrIpKey(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    // Cheap unverified parse — used only as a rate-limit key, never for
    // authorisation. If the token is malformed we fall through to IP.
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
        if (typeof payload.sub === 'string' && payload.sub.length > 0) {
          return `u:${payload.sub}`;
        }
      } catch {
        // fall through
      }
    }
  }
  return `ip:${req.ip}`;
}

/** Global plugin options — used as a baseline for every route. */
const globalOptions: RateLimitPluginOptions = {
  // Default cap if a route does not declare one. Generous; per-route
  // entries below tighten the sensitive endpoints.
  max: 100,
  timeWindow: 60_000,
};

/** Per-route caps. Apply via the route-level `config.rateLimit` option. */
const routes: Record<string, RateLimitOptions> = {
  '/request-reset':           { max: 5,  timeWindow: 60_000 },
  '/verify-email':            { max: 30, timeWindow: 60_000 },
  '/reset-password':          { max: 30, timeWindow: 60_000 },
  '/confirm-reset':           { max: 30, timeWindow: 60_000 },
  '/confirm-delete':          { max: 5,  timeWindow: 60_000 },
  '/resend-verification':     { max: 10, timeWindow: 5 * 60_000, keyGenerator: userOrIpKey },
  '/request-delete':          { max: 10, timeWindow: 5 * 60_000, keyGenerator: userOrIpKey },
  '/notify-password-change':  { max: 10, timeWindow: 5 * 60_000, keyGenerator: userOrIpKey },
  '/refresh-after-verify':    { max: 3,  timeWindow: 60_000,     keyGenerator: userOrIpKey },
  '/health':                  { max: 60, timeWindow: 60_000 },
};

export const rateLimitConfig = {
  global: globalOptions,
  routes,
};

/**
 * Helper for route plugins to attach their rate-limit config. Used as the
 * second argument to `fastify.post('/path', {...}, handler)`. Returns the
 * full route options object so callers can spread additional fields.
 */
export function rateLimitFor(path: keyof typeof routes): { config: { rateLimit: RateLimitOptions } } {
  return { config: { rateLimit: routes[path] } };
}
