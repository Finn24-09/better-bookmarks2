import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TRUST_PROXY } from './trustProxy.js';

// M-4 regression guard. `req.ip` is not cosmetic here: rateLimit.ts keys the
// unauthenticated caps (/request-reset and /confirm-delete at 5 req/min, plus
// the 100 req/min global) on it, and requestReset.ts / requestDelete.ts /
// resendVerification.ts / confirmDelete.ts persist it as the requested_ip
// column on auth.email_tokens.
//
// Two directions have to hold at once, and a config that satisfies only one
// is a live defect:
//
//   - Trusting too little collapses every IP-keyed bucket into a single key
//     (the Nginx container address), so one caller can spend the /request-reset
//     budget for the entire user base and lock everyone out of password reset.
//     This is exactly what fastify 5.12.1 introduced for `trustProxy: <number>`
//     — the fix for GHSA-3m5p-2c4r-xxw2 made hop-count trust fail closed,
//     silently, with no error and no failing test.
//
//   - Trusting too much (`trustProxy: true`) lets any client forge
//     X-Forwarded-For and so forge both their rate-limit key and their audit
//     trail.
//
// rateLimit.test.ts cannot catch either one: it fires every request from a
// single source, so its 429 assertion holds whichever address won. These
// tests pin the address itself.

// In production nothing but another container on the `betterbookmarks2` Docker
// bridge can open a socket to this service — no host port is published for it
// — so a 172.16/12 address stands in for the front-door Nginx. PUBLIC_PEER is
// the shape a direct client would have if that ever stopped being true.
const DOCKER_PEER = '172.18.0.5';
const PUBLIC_PEER = '198.51.100.7';
const FORGED = '203.0.113.10';

async function resolvedIpFor(remoteAddress: string): Promise<string> {
  const app = Fastify({ logger: false, trustProxy: TRUST_PROXY });
  app.get('/', (req) => ({ ip: req.ip }));
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress,
      headers: { 'x-forwarded-for': FORGED },
    });
    return (res.json() as { ip: string }).ip;
  } finally {
    await app.close();
  }
}

describe('M-4: TRUST_PROXY peer validation', () => {
  it('derives req.ip from X-Forwarded-For when the peer is the front-door proxy', async () => {
    await expect(resolvedIpFor(DOCKER_PEER)).resolves.toBe(FORGED);
  });

  it('derives req.ip from X-Forwarded-For for any private-range peer', async () => {
    await expect(resolvedIpFor('10.4.0.9')).resolves.toBe(FORGED);
    await expect(resolvedIpFor('192.168.16.3')).resolves.toBe(FORGED);
  });

  it('ignores a forged X-Forwarded-For from an untrusted public peer', async () => {
    await expect(resolvedIpFor(PUBLIC_PEER)).resolves.toBe(PUBLIC_PEER);
  });
});
