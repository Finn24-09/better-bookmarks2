import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

// H-2: this test verifies that the rate-limit configuration produced by
// src/rateLimit.ts behaves as expected — namely, that a per-route cap
// returns 429 once exceeded. The actual route registrations live in
// src/index.ts but we mount a minimal scaffold here so the test runs
// without spinning up the database, SMTP, etc.

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockSendMail  = vi.hoisted(() => vi.fn());

vi.mock('./config.js', () => ({
  config: {
    APP_BASE_URL: 'https://example.test',
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    NODE_ENV: 'test',
    JWT_AUDIENCE: 'email-svc',
    JWT_ISSUER: undefined,
  },
}));

vi.mock('./db.js', () => ({
  pool: { query: mockPoolQuery, connect: vi.fn() },
}));

vi.mock('./mailer.js', () => ({
  sendMail: mockSendMail,
}));

const { rateLimitConfig } = await import('./rateLimit.js');
const { requestResetRoute } = await import('./routes/requestReset.js');

// S-4: Tight time window for the live 429 test so the window cannot roll
// over before the 6th request lands on a slow CI runner. The behaviour
// being verified — 5 OK then a 429 — is window-size-independent.
// S-5: trustProxy:1 mirrors production (src/index.ts) so that the
// X-Forwarded-For sent by the test actually drives req.ip. Without this,
// req.ip stays loopback and the spoofed XFF→key mapping is not exercised.
async function makeApp(routeOverride?: { rateLimit?: { max?: number; timeWindow?: number } }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: 1 });
  await app.register(rateLimit, rateLimitConfig.global);

  const originalCfg = rateLimitConfig.routes['/request-reset'];
  if (routeOverride) {
    // S-4: Patch the per-route cap before the route plugin reads from
    // rateLimitFor() at registration time. We MUST keep the patch live
    // until app.ready() resolves — that is when fastify finishes wiring
    // the plugin tree and the route actually captures its config. If we
    // restore the original entry too early, the route ends up with the
    // production cap (5 req / 60_000 ms) which makes parallel-fire
    // tests non-deterministic.
    rateLimitConfig.routes['/request-reset'] = { ...originalCfg, ...routeOverride.rateLimit };
  }
  try {
    await app.register(requestResetRoute);
    await app.ready();
  } finally {
    rateLimitConfig.routes['/request-reset'] = originalCfg;
  }
  return app;
}

describe('H-2: in-service rate limiting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSendMail.mockResolvedValue(undefined);
    mockPoolQuery.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('H-2: /request-reset returns 429 after exceeding 5 req / IP / window', async () => {
    // S-4: A 60-second wall-clock window with a serial 5+1 loop was flaky
    // on slow CI runners — /request-reset has a built-in 800 ms timing
    // floor (anti-enumeration), so 5 sequential requests already ate
    // ~4 s of the window. Use a 30-second window (plenty of head-room
    // even on a slow CI box) and fire 5 in parallel, then a 6th
    // sequentially after they all settle. The rate-limit plugin
    // increments per request before the handler runs, so the 6th hits
    // the cap deterministically.
    const app = await makeApp({ rateLimit: { max: 5, timeWindow: 30_000 } });

    const fire = () =>
      app.inject({
        method: 'POST',
        url: '/request-reset',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
        body: JSON.stringify({ email: 'alice@example.com' }),
      });

    // S-5: trustProxy:1 in makeApp means req.ip resolves to the spoofed
    // x-forwarded-for value, so the rate-limit key is genuinely
    // IP-derived from the forwarded header — the path production
    // traffic actually takes.
    const first5 = await Promise.all([fire(), fire(), fire(), fire(), fire()]);
    for (const r of first5) {
      expect(r.statusCode).toBe(200);
    }
    const sixth = await fire();
    expect(sixth.statusCode).toBe(429);
  });

  it('H-2: rateLimitConfig exports per-route caps for all sensitive routes', () => {
    // Confirm the config has explicit caps for every route the security
    // review enumerates. The actual values are asserted in the route-level
    // test below.
    expect(rateLimitConfig.global.max).toBeTypeOf('number');
    expect(rateLimitConfig.routes['/request-reset']).toBeDefined();
    expect(rateLimitConfig.routes['/verify-email']).toBeDefined();
    expect(rateLimitConfig.routes['/reset-password']).toBeDefined();
    expect(rateLimitConfig.routes['/confirm-reset']).toBeDefined();
    expect(rateLimitConfig.routes['/confirm-delete']).toBeDefined();
    expect(rateLimitConfig.routes['/resend-verification']).toBeDefined();
    expect(rateLimitConfig.routes['/request-delete']).toBeDefined();
    expect(rateLimitConfig.routes['/notify-password-change']).toBeDefined();
    expect(rateLimitConfig.routes['/health']).toBeDefined();
  });

  it('H-2: per-route caps match the security-review specification', () => {
    expect(rateLimitConfig.routes['/request-reset']).toMatchObject({
      max: 5,
      timeWindow: 60_000,
    });
    expect(rateLimitConfig.routes['/verify-email']).toMatchObject({
      max: 30,
      timeWindow: 60_000,
    });
    expect(rateLimitConfig.routes['/reset-password']).toMatchObject({
      max: 30,
      timeWindow: 60_000,
    });
    expect(rateLimitConfig.routes['/confirm-reset']).toMatchObject({
      max: 30,
      timeWindow: 60_000,
    });
    expect(rateLimitConfig.routes['/confirm-delete']).toMatchObject({
      max: 5,
      timeWindow: 60_000,
    });
    expect(rateLimitConfig.routes['/resend-verification']).toMatchObject({
      max: 10,
      timeWindow: 5 * 60_000,
    });
    expect(rateLimitConfig.routes['/request-delete']).toMatchObject({
      max: 10,
      timeWindow: 5 * 60_000,
    });
    expect(rateLimitConfig.routes['/notify-password-change']).toMatchObject({
      max: 10,
      timeWindow: 5 * 60_000,
    });
    expect(rateLimitConfig.routes['/health']).toMatchObject({
      max: 60,
      timeWindow: 60_000,
    });
  });
});
