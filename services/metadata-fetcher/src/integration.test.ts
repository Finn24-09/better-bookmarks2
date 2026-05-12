import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

// Boot the full Fastify app and a real http.createServer target on
// localhost. The injected dispatch IS the real fetcher's behaviour
// against the local server — only DNS resolution and the final
// "dial-by-public-IP" path are stubbed, because the SSRF deny-list
// blocks 127.0.0.1 (which is what real localhost connections need).
// The dispatch translates the guard's public-IP decision into a real
// localhost socket, so the rest of the pipeline (timeouts, body cap,
// content-type check, redirect handling, error chain) runs against
// the real network/parser stack — not mocks.

vi.mock('./config.js', () => ({
  config: {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    JWT_AUDIENCE: 'metadata-svc',
    JWT_ISSUER: undefined,
    PORT: 5002,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  },
}));

import type { DispatchFn } from './fetcher.js';
const { titleRoute } = await import('./routes/title.js');
const { rateLimitConfig } = await import('./rateLimit.js');
const { LOG_REDACT_PATHS } = await import('./logRedact.js');
const { reqSerializer } = await import('./logSerializers.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));

async function makeToken(sub = '00000000-0000-4000-8000-000000000001'): Promise<string> {
  return new SignJWT({
    sub, role: 'app_user', aud: ['email-svc', 'metadata-svc'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }).setProtectedHeader({ alg: 'HS256' }).sign(secretKey);
}

interface MockResponse {
  status?: number;
  contentType?: string;
  body?: string | Buffer;
  /** Hold the socket open without writing — for timeout tests. */
  hang?: boolean;
  /** Sets Content-Encoding to test gzip rejection. */
  contentEncoding?: string;
  /** If set, returns a redirect with this Location. */
  location?: string;
}

class MockTarget {
  private server!: http.Server;
  public port!: number;
  private routes = new Map<string, MockResponse>();

  set(path: string, resp: MockResponse): this {
    this.routes.set(path, resp);
    return this;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost/');
      const spec = this.routes.get(url.pathname);
      if (!spec) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      if (spec.hang) {
        // Never write the body — the fetcher's timeout must fire.
        return;
      }
      if (spec.location) {
        res.statusCode = spec.status ?? 302;
        res.setHeader('Location', spec.location);
        res.end();
        return;
      }
      res.statusCode = spec.status ?? 200;
      res.setHeader('Content-Type', spec.contentType ?? 'text/html; charset=utf-8');
      if (spec.contentEncoding) res.setHeader('Content-Encoding', spec.contentEncoding);
      const body = typeof spec.body === 'string' ? Buffer.from(spec.body, 'utf-8') : (spec.body ?? Buffer.alloc(0));
      res.setHeader('Content-Length', String(body.length));
      res.end(body);
    });
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}

// Build a dispatch that ignores opts.ip / opts.port (which the SSRF guard
// computed against the stubbed public IP) and connects to the real local
// MockTarget instead. The fetcher's body-cap / timeout / redirect / status
// / content-type logic all runs against the genuine HTTP response.
function localDispatch(target: MockTarget): DispatchFn {
  return (opts) => new Promise((resolve, reject) => {
    const req = http.request({
      method: 'GET',
      host: '127.0.0.1',
      port: target.port,
      path: opts.pathQuery,
      headers: opts.headers,
    }, (res) => {
      resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers,
        body: res,
      });
    });
    req.on('error', err => reject(err));
    opts.signal.addEventListener('abort', () => req.destroy(opts.signal.reason), { once: true });
    req.end();
  });
}

async function buildApp(dispatch: DispatchFn, resolver: (host: string) => Promise<LookupAddress[]>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'silent',
      redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]', remove: false },
      serializers: { req: reqSerializer },
    },
    trustProxy: 1,
    bodyLimit: 4 * 1024,
    routerOptions: { ignoreTrailingSlash: true },
  });
  await app.register(rateLimit, rateLimitConfig.global);
  await app.register(titleRoute({ dispatch, resolver, timeoutMs: 500, globalCap: 32, perUserCap: 3 }));
  await app.ready();
  return app;
}

const publicResolver = (_host: string): Promise<LookupAddress[]> =>
  Promise.resolve([{ address: '8.8.8.8', family: 4 }]);

let target: MockTarget;
let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  target = new MockTarget();
  await target.start();
  // Heavy-page body: 1.5 MiB total with title at byte 600 KiB and </head>
  // shortly after — same shape as a YouTube watch page. Without the
  // streaming early-stop this would 422 the 1 MiB cap; with it we succeed
  // and return the title.
  const heavyPadding = 'x'.repeat(600 * 1024);
  const heavyTail = 'y'.repeat(900 * 1024);
  const heavyBody =
    `<head><meta property="og:title" content="Heavy Page Title">${heavyPadding}</head><body>${heavyTail}</body>`;

  target
    .set('/ok', { body: '<title>Real Server Title</title>' })
    .set('/pdf', { contentType: 'application/pdf', body: '%PDF-1.4' })
    .set('/gzip', { contentEncoding: 'gzip', body: 'fake-compressed' })
    .set('/hang', { hang: true })
    .set('/r-private', { location: 'http://127.0.0.1/internal' })
    .set('/r-public-host', { location: 'https://second.example/dst' })
    .set('/dst', { body: '<title>Redirected Page</title>' })
    .set('/no-title', { body: '<head></head><body>no head title</body>' })
    .set('/heavy', { body: heavyBody });
  app = await buildApp(localDispatch(target), publicResolver);
  token = await makeToken();
});

afterAll(async () => {
  await app.close();
  await target.stop();
});

async function post(url: string, sub?: string) {
  const tkn = sub ? await makeToken(sub) : token;
  return app.inject({
    method: 'POST', url: '/title',
    headers: { authorization: `Bearer ${tkn}`, 'content-type': 'application/json' },
    payload: { url },
  });
}

describe('integration: real HTTP target + full Fastify pipeline', () => {
  it('happy path: 200 with title from real server', async () => {
    const res = await post('https://target.example/ok');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: 'Real Server Title' });
  });

  it('content-type rejection: 422 for application/pdf', async () => {
    const res = await post('https://target.example/pdf');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Unsupported content type' });
  });

  it('gzip-bomb defence: 422 for Content-Encoding: gzip', async () => {
    const res = await post('https://target.example/gzip');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Compressed response not supported' });
  });

  it('timeout: 504 when target hangs past timeoutMs', async () => {
    const res = await post('https://target.example/hang');
    expect(res.statusCode).toBe(504);
    expect(res.json()).toEqual({ error: 'Upstream timeout' });
  }, 5000);

  it('redirect to private literal: 422 (SSRF guard rejects on redirect hop)', async () => {
    const res = await post('https://target.example/r-private');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Target not allowed' });
  });

  it('redirect re-resolution: follows to a different public hostname', async () => {
    // Resolver returns 8.8.8.8 for any hostname → both first.example and
    // second.example are accepted by the SSRF guard. The dispatch then maps
    // both to the local MockTarget, which serves /dst at the second hop.
    const res = await post('https://target.example/r-public-host');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: 'Redirected Page' });
  });

  it('title:null when extractor finds no candidate', async () => {
    const res = await post('https://target.example/no-title');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: null });
  });

  // Regression for the YouTube failure mode: heavy HTML (1.5 MiB total) with
  // the title past byte 600 KiB. Pre-streaming-fix this would 422 because the
  // body cap was 1 MiB and the title sat past it; the streaming early-stop
  // resolves once </head> is in.
  it('heavy page (1.5 MiB body with title at byte 600 KiB) succeeds via streaming early-stop', async () => {
    const res = await post('https://target.example/heavy');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ title: 'Heavy Page Title' });
  });
});

describe('integration: DNS rebinding defence', () => {
  it('rejects when redirect target resolves to a private IP', async () => {
    // Resolver returns public for first.example, private for second.example.
    // The first hop succeeds; the second hop is rejected by the SSRF guard
    // BEFORE any dispatch fires (verified by counting dispatches).
    let dispatchCount = 0;
    const rebindResolver = async (host: string): Promise<LookupAddress[]> => {
      if (host === 'first.example') return [{ address: '8.8.8.8', family: 4 }];
      if (host === 'second.example') return [{ address: '10.0.0.5', family: 4 }];
      return [{ address: '8.8.8.8', family: 4 }];
    };
    const countingDispatch: DispatchFn = async (opts) => {
      dispatchCount++;
      return localDispatch(target)(opts);
    };
    const dedicatedApp = await buildApp(countingDispatch, rebindResolver);
    try {
      // first.example/r-public-host redirects to https://second.example/dst.
      // Second.example resolves private → rejected.
      const res = await dedicatedApp.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://first.example/r-public-host' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'Target not allowed' });
      // First hop dispatched, second hop never reached the dispatch (guard
      // rejected pre-dispatch on the new hostname's resolved IP).
      expect(dispatchCount).toBe(1);
    } finally {
      await dedicatedApp.close();
    }
  });
});

describe('integration: error sanitisation canary', () => {
  it('upstream connection refusal does not leak the target hostname or IP', async () => {
    // Resolver returns public, but the dispatch refuses connection.
    const refuseDispatch: DispatchFn = async () => {
      throw new Error('connect ECONNREFUSED victim.example.com:443 (resolved 8.8.8.8)');
    };
    const dedicatedApp = await buildApp(refuseDispatch, publicResolver);
    try {
      const res = await dedicatedApp.inject({
        method: 'POST', url: '/title',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { url: 'https://victim.example.com/' },
      });
      expect(res.statusCode).toBe(502);
      // Generic body — no leak.
      expect(res.payload).not.toContain('victim');
      expect(res.payload).not.toContain('8.8.8.8');
    } finally {
      await dedicatedApp.close();
    }
  });
});
