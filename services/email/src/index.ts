import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { rateLimitConfig } from './rateLimit.js';
import { dbHealth, startDbHealthLoop } from './health.js';
import { requestResetRoute } from './routes/requestReset.js';
import { resetPasswordRoute } from './routes/resetPassword.js';
import { confirmResetRoute } from './routes/confirmReset.js';
import { verifyEmailRoute } from './routes/verifyEmail.js';
import { resendVerificationRoute } from './routes/resendVerification.js';
import { requestDeleteRoute } from './routes/requestDelete.js';
import { confirmDeleteRoute } from './routes/confirmDelete.js';
import { notifyPasswordChangeRoute } from './routes/notifyPasswordChange.js';

const fastify = Fastify({
  logger: true,
  // M-4: trust ONE proxy hop (the front-door Nginx). With trustProxy:true
  // (boolean), Fastify accepts any value in X-Forwarded-For, which lets a
  // remote client forge their apparent IP for both audit logs and
  // rate-limit keying. trustProxy:1 makes Fastify peel exactly one hop —
  // the trusted Nginx — and ignore further forwarded headers from outside
  // the trust boundary. Adjust if the deployment puts more reverse
  // proxies in front of this service.
  trustProxy: 1,
});

await fastify.register(cookie, { secret: config.COOKIE_SECRET });

// H-2: in-service rate limiting. Per-route caps live in src/rateLimit.ts
// and are attached at registration time via rateLimitFor(path). Nginx ALSO
// rate-limits, but treat that as defence-in-depth — Nginx misconfiguration
// or bypass must not leave brute-force/enumeration surfaces unbounded.
await fastify.register(rateLimit, rateLimitConfig.global);

// Global error handler — never leak internal details (M-2)
fastify.setErrorHandler((err, _req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  }
  return reply.status(status).send({ error: 'Invalid request' });
});

fastify.get(
  '/health',
  { config: { rateLimit: rateLimitConfig.routes['/health'] } },
  async (_req, reply) => {
    // M-3: serve cached state. Hitting pool.query on every probe turned
    // /health into an unauthenticated DB oracle and a denial-of-wallet
    // amplifier (every probe = one DB connection). The state is updated
    // by a 30-second in-process loop (see ./health.ts). N-6: SMTP
    // reachability is intentionally not part of /health — failed sends
    // are logged per-route and visible via SES bounce/complaint metrics.
    if (!dbHealth.ok) {
      return reply.status(503).send({ ok: false });
    }
    return reply.status(200).send({ ok: true });
  },
);

// Start the background DB ping. unref'd so it never holds the process open.
startDbHealthLoop();

await fastify.register(requestResetRoute);
await fastify.register(resetPasswordRoute);
await fastify.register(confirmResetRoute);
await fastify.register(verifyEmailRoute);
await fastify.register(resendVerificationRoute);
await fastify.register(requestDeleteRoute);
await fastify.register(confirmDeleteRoute);
await fastify.register(notifyPasswordChangeRoute);

// Periodic cleanup of expired/used tokens (runs every 15 minutes).
//
// S-3: Store the timer, .unref() it so the loop alone does not hold the
// process open, and clear it on fastify.close so SIGTERM / graceful
// shutdown actually exits. Also guard the async handler so a query
// fired against a pool that has begun draining does not surface as an
// unhandled promise rejection after onClose has run.
let cleanupShuttingDown = false;
const cleanupInterval = setInterval(() => {
  if (cleanupShuttingDown) return;
  void (async () => {
    try {
      if (cleanupShuttingDown) return;
      await pool.query('SELECT auth.cleanup_email_tokens()');
    } catch (err) {
      // Pool has been ended, or DB unreachable. Either way: log and
      // continue. The next interval will retry if the process is still
      // alive; if we're shutting down, the timer will already be cleared.
      if (!cleanupShuttingDown) {
        fastify.log.error({ err }, 'cleanup_email_tokens failed');
      }
    }
  })();
}, 15 * 60 * 1000);
if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref();

fastify.addHook('onClose', async () => {
  cleanupShuttingDown = true;
  clearInterval(cleanupInterval);
});

try {
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
