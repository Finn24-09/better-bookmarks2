import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { LookupAddress } from 'node:dns';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

vi.mock('../config.js', () => ({
  config: {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    JWT_AUDIENCE: 'metadata-svc',
    JWT_ISSUER: undefined,
    PORT: 5002,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // Small cap exercises the wiring from config → route → fetcher.
    // Tests that need a different cap pass `bodyLimitBytes` via routeDeps;
    // the route gives that override precedence.
    MAX_BODY_BYTES: 256 * 1024,
  },
}));

const { titleRoute } = await import('./title.js');
const { rateLimitConfig } = await import('../rateLimit.js');
const { LOG_REDACT_PATHS } = await import('../logRedact.js');
const { reqSerializer } = await import('../logSerializers.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));

const VALID_SUB = '00000000-0000-4000-8000-000000000001';

async function makeToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const base: Record<string, unknown> = {
    sub: VALID_SUB,
    role: 'app_user',
    aud: ['email-svc', 'metadata-svc'],
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete base[k];
  }
  return new SignJWT(base).setProtectedHeader({ alg: 'HS256' }).sign(secretKey);
}

const publicResolver = (_host: string): Promise<LookupAddress[]> =>
  Promise.resolve([{ address: '8.8.8.8', family: 4 }]);

const privateResolver = (_host: string): Promise<LookupAddress[]> =>
  Promise.resolve([{ address: '10.0.0.5', family: 4 }]);

interface DispatchSpec {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Throw this instead of returning. */
  throws?: Error;
}

function makeDispatch(specs: DispatchSpec[] | DispatchSpec) {
  const queue = Array.isArray(specs) ? specs : [specs];
  let i = 0;
  const calls: { headers: Record<string, string>; host: string; ip: string }[] = [];
  const dispatch = async (opts: {
    host: string; ip: string; headers: Record<string, string>; signal: AbortSignal;
  }) => {
    calls.push({ host: opts.host, ip: opts.ip, headers: { ...opts.headers } });
    const spec = queue[Math.min(i++, queue.length - 1)];
    if (spec.throws) throw spec.throws;
    const body = typeof spec.body === 'string'
      ? Buffer.from(spec.body, 'utf-8')
      : (spec.body ?? Buffer.alloc(0));
    return {
      statusCode: spec.statusCode ?? 200,
      headers: { 'content-type': 'text/html', ...(spec.headers ?? {}) },
      body: Readable.from([body]),
    };
  };
  return { dispatch, calls };
}

async function buildTestApp(
  routeDeps: Parameters<typeof titleRoute>[0] = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'silent',
      redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]', remove: false },
      serializers: { req: reqSerializer },
    },
    trustProxy: 1,
    bodyLimit: 4 * 1024,
    // Mirror the production buildServer() config so the trailing-slash
    // regression test exercises the same routing behaviour as a deployed
    // container.
    routerOptions: { ignoreTrailingSlash: true },
  });
  await app.register(rateLimit, rateLimitConfig.global);
  await app.register(titleRoute(routeDeps));
  await app.ready();
  return app;
}

describe('POST /title — auth', () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = await buildTestApp({ resolver: publicResolver }); });
  afterEach(async () => { await app.close(); });

  it('401 when no Authorization header', async () => {
    const res = await app.inject({ method: 'POST', url: '/title', payload: { url: 'https://x.example/' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('401 when bearer is malformed', async () => {
    const res = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: 'Bearer not-a-jwt' },
      payload: { url: 'https://x.example/' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when audience does not match', async () => {
    const token = await makeToken({ aud: 'email-svc' });
    const res = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'https://x.example/' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when the email_verified claim is missing (required by jose)', async () => {
    const token = await makeToken({ email_verified: undefined });
    const res = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'https://x.example/' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 with body {error:"Email not verified"} when email_verified is strictly false', async () => {
    const token = await makeToken({ email_verified: false });
    const res = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${token}` },
      payload: { url: 'https://x.example/' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Email not verified' });
  });

  it('403 body is byte-identical across different sub values (no enumeration via response)', async () => {
    const tokenA = await makeToken({ sub: '00000000-0000-4000-8000-00000000000A', email_verified: false });
    const tokenB = await makeToken({ sub: '00000000-0000-4000-8000-00000000000B', email_verified: false });
    const resA = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { url: 'https://x.example/' },
    });
    const resB = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { url: 'https://x.example/' },
    });
    expect(resA.statusCode).toBe(403);
    expect(resB.statusCode).toBe(403);
    expect(resA.body).toBe(resB.body);
  });
});

describe('POST /title — body validation', () => {
  let app: FastifyInstance;
  let token: string;
  beforeEach(async () => {
    app = await buildTestApp({ resolver: publicResolver });
    token = await makeToken();
  });
  afterEach(async () => { await app.close(); });

  async function post(payload: unknown, contentType = 'application/json') {
    return app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }

  it('400 when body missing url field', async () => {
    const res = await post({});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid request' });
  });

  it('400 when url is not a string', async () => {
    const res = await post({ url: 123 });
    expect(res.statusCode).toBe(400);
  });

  it('400 when url is empty string', async () => {
    const res = await post({ url: '' });
    expect(res.statusCode).toBe(400);
  });

  it('400 when url > 2000 chars', async () => {
    const res = await post({ url: 'http://example.com/' + 'a'.repeat(2000) });
    expect(res.statusCode).toBe(400);
  });

  it('400 when body is empty', async () => {
    const res = await post('');
    expect(res.statusCode).toBe(400);
  });

  it('400 when body is not JSON', async () => {
    const res = await post('plain text body', 'text/plain');
    expect(res.statusCode).toBe(400);
  });

  it('400 on file:// scheme (SSRF guard rejects via fetcher)', async () => {
    const res = await post({ url: 'file:///etc/passwd' });
    // The fetcher's SSRF guard returns FetchBlockedError; route maps to 422.
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /title — fetcher integration', () => {
  let token: string;
  beforeEach(async () => { token = await makeToken(); });

  async function exercise(routeDeps: Parameters<typeof titleRoute>[0]) {
    const app = await buildTestApp(routeDeps);
    const res = await app.inject({
      method: 'POST', url: '/title',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { url: 'https://victim.example/path' },
    });
    await app.close();
    return res;
  }

  it('200 with { title } on happy path', async () => {
    const { dispatch } = makeDispatch({ body: '<title>Example Page</title>' });
    const res = await exercise({ resolver: publicResolver, dispatch });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: 'Example Page' });
  });

  // Regression: the Vite dev proxy rewrite preserved the trailing slash on
  // /api/title/, so the service received `POST /title/`. Fastify's default
  // ignoreTrailingSlash:false treated this as a different route from /title,
  // returning 404 and surfacing as "Couldn't fetch title" in the UI with no
  // useful log line. The fix sets ignoreTrailingSlash:true in index.ts;
  // this test wires the modal-facing test app the same way and asserts both
  // forms route to the same handler.
  // Regression: config.MAX_BODY_BYTES (the operator-tunable env override)
  // must actually flow into the fetcher when the route is constructed with
  // no body-limit override. The mock above sets the config value to 256 KiB;
  // a 300 KiB body with no </head> exceeds that cap and must 422.
  it('honours config.MAX_BODY_BYTES when no deps.bodyLimitBytes is provided', async () => {
    // 300 KiB body, no </head> → cap-fallback path fires at the config value.
    const big = 'x'.repeat(300 * 1024);
    const { dispatch } = makeDispatch({ body: big });
    const app = await buildTestApp({ resolver: publicResolver, dispatch });
    try {
      const token = await makeToken();
      const res = await app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://example.com/' },
      });
      // 422 from FetchBodyTooLargeError → route maps to "Target response too large".
      expect(res.statusCode).toBe(422);
    } finally {
      await app.close();
    }
  });

  it('200 on POST /title/ (trailing slash) — regression for dev-proxy bug', async () => {
    const { dispatch } = makeDispatch({ body: '<title>Trailing Slash OK</title>' });
    const app = await buildTestApp({ resolver: publicResolver, dispatch });
    try {
      const token = await makeToken();
      const res = await app.inject({
        method: 'POST', url: '/title/',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://example.com/' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ title: 'Trailing Slash OK' });
    } finally {
      await app.close();
    }
  });

  it('200 with { title: null } when extractor returns null', async () => {
    const { dispatch } = makeDispatch({ body: '<head></head><body>no title</body>' });
    const res = await exercise({ resolver: publicResolver, dispatch });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: null });
  });

  it('422 when SSRF guard rejects (private IP)', async () => {
    const { dispatch } = makeDispatch({ body: '<title>X</title>' });
    const res = await exercise({ resolver: privateResolver, dispatch });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Target not allowed' });
  });

  it('422 when content-type is not text/html', async () => {
    const { dispatch } = makeDispatch({ body: '%PDF-1.4', headers: { 'content-type': 'application/pdf' } });
    const res = await exercise({ resolver: publicResolver, dispatch });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Unsupported content type' });
  });

  it('422 on compressed response (gzip-bomb defence)', async () => {
    const { dispatch } = makeDispatch({ body: 'x', headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } });
    const res = await exercise({ resolver: publicResolver, dispatch });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Compressed response not supported' });
  });

  it('502 on upstream 500', async () => {
    const { dispatch } = makeDispatch({ statusCode: 500, body: '' });
    const res = await exercise({ resolver: publicResolver, dispatch });
    expect(res.statusCode).toBe(502);
  });

  it('502 on connection error', async () => {
    const { dispatch } = makeDispatch({ throws: new Error('ECONNREFUSED 8.8.8.8') });
    const res = await exercise({ resolver: publicResolver, dispatch });
    expect(res.statusCode).toBe(502);
  });

  it('504 on timeout', async () => {
    // Use a stream that never emits and the route-level timeoutMs override.
    const dispatch = async (opts: { signal: AbortSignal }) => {
      const stream = new Readable({ read() { /* never emits */ } });
      opts.signal.addEventListener('abort', () => stream.destroy(opts.signal.reason));
      return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: stream };
    };
    const res = await exercise({ resolver: publicResolver, dispatch, timeoutMs: 50 });
    expect(res.statusCode).toBe(504);
  });
});

describe('POST /title — concurrency caps', () => {
  let token: string;
  beforeEach(async () => { token = await makeToken(); });

  it('429 when per-user concurrent cap exceeded', async () => {
    // Use a dispatch that blocks until we release it; that holds the semaphore.
    let release: () => void = () => {};
    const block = new Promise<void>((r) => { release = r; });
    const dispatch = async (opts: { signal: AbortSignal }) => {
      await block;
      const stream = new Readable({ read() { this.push('<title>x</title>'); this.push(null); } });
      void opts;
      return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: stream };
    };
    const app = await buildTestApp({ resolver: publicResolver, dispatch, perUserCap: 1 });
    try {
      const first = app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://x.example/' },
      });
      // Give the first request time to acquire the per-user slot before issuing the second.
      await new Promise(r => setImmediate(r));
      const second = await app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://x.example/' },
      });
      expect(second.statusCode).toBe(429);
      release();
      await first;
    } finally {
      await app.close();
    }
  });

  it('503 when global concurrent cap exceeded', async () => {
    let release: () => void = () => {};
    const block = new Promise<void>((r) => { release = r; });
    const dispatch = async (opts: { signal: AbortSignal }) => {
      await block;
      void opts;
      const stream = new Readable({ read() { this.push('<title>x</title>'); this.push(null); } });
      return { statusCode: 200, headers: { 'content-type': 'text/html' }, body: stream };
    };
    const app = await buildTestApp({ resolver: publicResolver, dispatch, globalCap: 1, perUserCap: 5 });
    try {
      // Use two different users so per-user cap doesn't trigger.
      const t1 = await makeToken({ sub: '00000000-0000-4000-8000-000000000001' });
      const t2 = await makeToken({ sub: '00000000-0000-4000-8000-000000000002' });
      const first = app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${t1}`, 'content-type': 'application/json' },
        payload: { url: 'https://x.example/' },
      });
      await new Promise(r => setImmediate(r));
      const second = await app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${t2}`, 'content-type': 'application/json' },
        payload: { url: 'https://x.example/' },
      });
      expect(second.statusCode).toBe(503);
      release();
      await first;
    } finally {
      await app.close();
    }
  });
});

describe('POST /title — log sanitisation canary', () => {
  it('error responses do not leak the target hostname or IP', async () => {
    const { dispatch } = makeDispatch({ throws: new Error('connect ECONNREFUSED victim.example:443 (resolved 93.184.216.34)') });
    const app = await buildTestApp({ resolver: publicResolver, dispatch });
    try {
      const token = await makeToken();
      const res = await app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://victim.example/path' },
      });
      expect(res.statusCode).toBe(502);
      expect(res.payload).not.toContain('victim.example');
      expect(res.payload).not.toContain('93.184.216.34');
    } finally {
      await app.close();
    }
  });

  it('logs do not leak target hostname for getaddrinfo ENOTFOUND', async () => {
    const logs: string[] = [];
    const dispatch = async () => { throw new Error('getaddrinfo ENOTFOUND victim.example.com'); };
    const app = Fastify({
      logger: {
        level: 'error',
        redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]', remove: false },
        serializers: { req: reqSerializer },
        stream: { write: (chunk: string) => { logs.push(chunk); return true; } } as unknown as NodeJS.WritableStream,
      },
      trustProxy: 1,
      bodyLimit: 4 * 1024,
      // Mirror the production buildServer() config — see buildTestApp comment.
      routerOptions: { ignoreTrailingSlash: true },
    });
    await app.register(rateLimit, rateLimitConfig.global);
    await app.register(titleRoute({ resolver: publicResolver, dispatch }));
    await app.ready();
    try {
      const token = await makeToken();
      await app.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://victim.example.com/' },
      });
      const all = logs.join('');
      expect(all).not.toContain('victim.example.com');
    } finally {
      await app.close();
    }
  });

  it('concurrent failures do not bleed hostnames across requests', async () => {
    // Two simultaneous requests for different hosts; each error chain
    // must scrub ONLY its own hostname. The captured logs/responses must
    // not contain the other request's hostname.
    let counter = 0;
    const dispatch = async () => {
      const host = counter++ === 0 ? 'alpha.example' : 'beta.example';
      throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    };
    const app = await buildTestApp({ resolver: publicResolver, dispatch });
    try {
      const token = await makeToken();
      const [r1, r2] = await Promise.all([
        app.inject({
          method: 'POST', url: '/title',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: { url: 'https://alpha.example/' },
        }),
        app.inject({
          method: 'POST', url: '/title',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: { url: 'https://beta.example/' },
        }),
      ]);
      // Generic error bodies — no host bleed.
      expect(r1.payload).not.toContain('alpha.example');
      expect(r1.payload).not.toContain('beta.example');
      expect(r2.payload).not.toContain('alpha.example');
      expect(r2.payload).not.toContain('beta.example');
    } finally {
      await app.close();
    }
  });
});
