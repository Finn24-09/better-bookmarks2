import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { rateLimitConfig } from './rateLimit.js';
import { LOG_REDACT_PATHS } from './logRedact.js';
import { reqSerializer } from './logSerializers.js';
import { registry } from './metrics.js';
import { VERSION } from './version.js';
import { titleRoute } from './routes/title.js';

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        // Spread into a fresh array because pino's options expect a mutable string[].
        paths: [...LOG_REDACT_PATHS],
        censor: '[redacted]',
        remove: false,
      },
      // Custom serializer scrubs `?token=` / `?code=` query params from `req.url`.
      // Pino's redact only matches object property paths; without this, the
      // global error handler would write those values to stdout.
      serializers: { req: reqSerializer },
    },
    // Trust ONE proxy hop (the front-door Nginx). trustProxy:true would let a
    // remote client forge X-Forwarded-For for both audit logs and rate-limit
    // keying. trustProxy:1 peels exactly one hop.
    trustProxy: 1,
    // 4 KiB inbound body cap. The only legitimate body is `{"url":"…"}` with
    // URL length ≤ 2000; 4 KiB is two orders of magnitude above ceiling and
    // matches Nginx's per-location client_max_body_size 4k.
    bodyLimit: 4 * 1024,
  });

  // Visible startup banner — operators reading `docker compose logs
  // metadata-fetcher` see the version on every container start without
  // needing to call out to a separate /version endpoint.
  fastify.log.info(
    {
      service: 'metadata-fetcher',
      version: VERSION,
      node: process.version,
      port: config.PORT,
    },
    `metadata-fetcher v${VERSION} starting (node ${process.version}, port ${config.PORT})`,
  );

  await fastify.register(rateLimit, rateLimitConfig.global);

  // Global error handler — never leak internal details.
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
      // Stateless service: no DB, no SMTP, nothing external. /health reports
      // only process liveness — Docker's healthcheck plus the cap_drop /
      // read_only constraints make tighter signals unnecessary.
      return reply.status(200).send({ ok: true });
    },
  );

  fastify.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });

  // POST /title — the only user-facing route. The plugin installs its own
  // setErrorHandler that sanitises err.cause chains before pino sees them;
  // that handler is scoped to the plugin context and overrides the global
  // one above for any error originating inside the route.
  await fastify.register(titleRoute());

  return fastify;
}

// Only start the server when this file is the process entry point. The
// guard lets the test suite call buildServer() without binding a port.
const isEntry = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '');

if (isEntry) {
  const fastify = await buildServer();
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
