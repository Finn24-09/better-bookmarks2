import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions, RateLimitPluginOptions } from '@fastify/rate-limit';

// Per-route rate limit caps.
//
// Service-side limits sit alongside Nginx limits as defence-in-depth — Nginx
// is a single point of failure, and a misconfiguration that removes its
// limit_req block must not leave authenticated routes unbounded.
//
//   POST /title  – 30 req / user / 60 s  (interactive auto-fill cadence)
//   GET  /health –  60 req / IP   / 60 s
//   GET  /metrics – not rate-limited at the route level; Nginx 404s any
//                   public path under /api/title/ other than the exact
//                   POST /api/title/ route, so /metrics is unreachable
//                   from outside the deployment.

/**
 * Key authenticated routes by JWT `sub` when present, falling back to remote
 * IP. Intentionally duplicated from services/email/src/rateLimit.ts — keeping
 * each service's package.json self-contained is worth the small redundancy.
 * Any change here must be replicated there.
 */
function userOrIpKey(req: FastifyRequest): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
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

const globalOptions: RateLimitPluginOptions = {
  max: 100,
  timeWindow: 60_000,
};

const routes: Record<string, RateLimitOptions> = {
  '/title':   { max: 30, timeWindow: 60_000, keyGenerator: userOrIpKey },
  '/health':  { max: 60, timeWindow: 60_000 },
};

export const rateLimitConfig = {
  global: globalOptions,
  routes,
};

export function rateLimitFor(path: keyof typeof routes): { config: { rateLimit: RateLimitOptions } } {
  return { config: { rateLimit: routes[path] } };
}
