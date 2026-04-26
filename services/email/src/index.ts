import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config.js';
import { pool } from './db.js';
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
  trustProxy: true,
});

await fastify.register(cookie, { secret: config.COOKIE_SECRET });

// Global error handler — never leak internal details (M-2)
fastify.setErrorHandler((err, _req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  }
  return reply.status(status).send({ error: 'Invalid request' });
});

fastify.get('/health', async (_req, reply) => {
  await pool.query('SELECT 1');
  return reply.status(200).send({ ok: true });
});

await fastify.register(requestResetRoute);
await fastify.register(resetPasswordRoute);
await fastify.register(confirmResetRoute);
await fastify.register(verifyEmailRoute);
await fastify.register(resendVerificationRoute);
await fastify.register(requestDeleteRoute);
await fastify.register(confirmDeleteRoute);
await fastify.register(notifyPasswordChangeRoute);

// Periodic cleanup of expired/used tokens (runs every 15 minutes)
setInterval(async () => {
  try {
    await pool.query('SELECT auth.cleanup_email_tokens()');
  } catch (err) {
    fastify.log.error({ err }, 'cleanup_email_tokens failed');
  }
}, 15 * 60 * 1000);

try {
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
