import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { verifyJwt, EmailNotVerifiedError } from '../jwt.js';
import { rateLimitFor } from '../rateLimit.js';
import {
  fetchHead,
  type DispatchFn,
  type FetchOptions,
  FetchBlockedError,
  FetchBodyTooLargeError,
  FetchCompressedBodyError,
  FetchUnsupportedContentTypeError,
  FetchRedirectDowngradeError,
  FetchTooManyRedirectsError,
  FetchTimeoutError,
  FetchUpstreamError,
} from '../fetcher.js';
import { extractTitle } from '../titleExtractor.js';
import { Semaphore, PerKeySemaphore } from '../concurrency.js';
import { requestsTotal, type Outcome, upstreamLatencySeconds, bodyTerminationTotal } from '../metrics.js';
import { sanitizeErrorChain } from '../errorSanitizer.js';
import type { Resolver } from '../ssrfGuard.js';

const bodySchema = z.object({
  url: z.string().min(1).max(2000),
});

// Capacity limits — keep these in sync with the spec § "Rate limits &
// concurrency". The 4 KiB Fastify bodyLimit at the server level plus 30/min
// per-user rate-limit at the route level plus these semaphore caps form the
// service-wide DoS posture.
export const GLOBAL_CONCURRENT_CAP = 32;
export const PER_USER_CONCURRENT_CAP = 3;

declare module 'fastify' {
  interface FastifyRequest {
    /** Captured by the route handler after the SSRF guard validates the
     *  hostname, so the error-chain sanitiser can redact it from any err.cause
     *  that surfaces during the dispatch. Per-request bag, not ALS — cannot
     *  bleed between concurrent requests. */
    targetHostname?: string | null;
  }
}

interface RouteDeps {
  /** Injected for unit/integration tests. Production uses Node http/https. */
  dispatch?: DispatchFn;
  resolver?: Resolver;
  /** Override the abort timeout — tests set a small value to keep runs fast. */
  timeoutMs?: number;
  /** Override the body limit — tests use small values to drive the cap path. */
  bodyLimitBytes?: number;
  /** Override the global concurrent cap — tests use small values to exercise 503. */
  globalCap?: number;
  /** Override the per-user concurrent cap — tests use small values to exercise 429. */
  perUserCap?: number;
}

/**
 * POST /title — accept a user-supplied URL, fetch its <title> server-side,
 * return { title }. See spec §4 for the full contract.
 */
export function titleRoute(deps: RouteDeps = {}): FastifyPluginAsync {
  const globalSem = new Semaphore(deps.globalCap ?? GLOBAL_CONCURRENT_CAP);
  const perUserSem = new PerKeySemaphore(deps.perUserCap ?? PER_USER_CONCURRENT_CAP);

  return async (fastify) => {
    fastify.decorateRequest('targetHostname', null);

    fastify.post(
      '/title',
      rateLimitFor('/title'),
      async (req, reply) => {
        let sub: string;
        try {
          ({ sub } = await verifyJwt(req.headers.authorization));
        } catch (err) {
          // Email-verified gate failure (claim present + signed but not
          // strictly true) → 403, distinct from the 401 unauthorized path.
          // Body is intentionally byte-identical for every caller — it
          // depends only on the caller's own claim, never on server-side
          // state, so it cannot be used to enumerate accounts.
          if (err instanceof EmailNotVerifiedError) {
            requestsTotal.labels('email-not-verified').inc();
            return reply.status(403).send({ error: 'Email not verified' });
          }
          requestsTotal.labels('unauthorized').inc();
          return reply.status(401).send({ error: 'Unauthorized' });
        }

        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) {
          requestsTotal.labels('invalid-input').inc();
          return reply.status(400).send({ error: 'Invalid request' });
        }

        // Global concurrent cap → 503 immediately (no queueing — queueing
        // extends the attack window for slowloris targets).
        if (!globalSem.tryAcquire()) {
          requestsTotal.labels('concurrency-limited').inc();
          return reply.status(503).send({ error: 'Service busy' });
        }
        // Per-user concurrent cap → 429 (the user is asked to slow down).
        if (!perUserSem.tryAcquire(sub)) {
          globalSem.release();
          requestsTotal.labels('rate-limited').inc();
          return reply.status(429).send({ error: 'Too many concurrent requests' });
        }

        const start = process.hrtime.bigint();
        try {
          const fetchOpts: FetchOptions = {
            onHop: ({ host }) => { req.targetHostname = host; },
            // Default the body cap from the env-derived config so operators
            // can tune MAX_BODY_BYTES without a code change. The test-only
            // `deps.bodyLimitBytes` override still wins when supplied.
            bodyLimitBytes: deps.bodyLimitBytes ?? config.MAX_BODY_BYTES,
          };
          if (deps.dispatch !== undefined) fetchOpts.dispatch = deps.dispatch;
          if (deps.resolver !== undefined) fetchOpts.resolver = deps.resolver;
          if (deps.timeoutMs !== undefined) fetchOpts.timeoutMs = deps.timeoutMs;
          const { bytes, charset, terminationReason } = await fetchHead(parsed.data.url, fetchOpts);
          const title = extractTitle(bytes, charset);

          const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
          upstreamLatencySeconds.observe(elapsed);
          requestsTotal.labels('ok').inc();
          bodyTerminationTotal.labels(terminationReason).inc();
          return reply.status(200).send({ title });
        } catch (err) {
          const { status, body, outcome, logIt } = classifyFetcherError(err);
          sanitizeErrorChain(err, req.targetHostname ?? null);
          if (logIt) req.log.error({ err }, 'metadata-fetcher upstream failure');
          requestsTotal.labels(outcome).inc();
          return reply.status(status).send(body);
        } finally {
          perUserSem.release(sub);
          globalSem.release();
        }
      },
    );

    // Global error handler at the plugin level: scrub error chains before
    // pino sees them. (Fastify lets the plugin install setErrorHandler;
    // index.ts also installs a generic 500 fallback in case a non-route
    // path throws.)
    fastify.setErrorHandler((err, req, reply) => {
      const hostname = req.targetHostname ?? null;
      sanitizeErrorChain(err, hostname);
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal error' });
      }
      return reply.status(status).send({ error: 'Invalid request' });
    });
  };
}

interface ErrorClassification {
  status: number;
  body: { error: string };
  outcome: Outcome;
  logIt: boolean;
}

function classifyFetcherError(err: unknown): ErrorClassification {
  if (err instanceof FetchBlockedError) {
    return { status: 422, body: { error: 'Target not allowed' }, outcome: 'blocked-host', logIt: false };
  }
  if (err instanceof FetchTimeoutError) {
    return { status: 504, body: { error: 'Upstream timeout' }, outcome: 'timeout', logIt: false };
  }
  if (err instanceof FetchBodyTooLargeError) {
    return { status: 422, body: { error: 'Target response too large' }, outcome: 'body-too-large', logIt: false };
  }
  if (err instanceof FetchCompressedBodyError) {
    return { status: 422, body: { error: 'Compressed response not supported' }, outcome: 'compressed-body', logIt: false };
  }
  if (err instanceof FetchUnsupportedContentTypeError) {
    return { status: 422, body: { error: 'Unsupported content type' }, outcome: 'content-type-rejected', logIt: false };
  }
  if (err instanceof FetchRedirectDowngradeError) {
    return { status: 422, body: { error: 'Redirect downgrade rejected' }, outcome: 'redirect-downgrade', logIt: false };
  }
  if (err instanceof FetchTooManyRedirectsError) {
    return { status: 422, body: { error: 'Too many redirects' }, outcome: 'redirect-loop', logIt: false };
  }
  if (err instanceof FetchUpstreamError) {
    return { status: 502, body: { error: 'Upstream error' }, outcome: 'upstream-error', logIt: true };
  }
  return { status: 502, body: { error: 'Upstream error' }, outcome: 'upstream-error', logIt: true };
}
