import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { TRUST_PROXY } from './trustProxy.js';

// Regression guard for the proxy trust boundary. Intentionally duplicated
// from services/email/src/trustProxy.test.ts — keeping each service
// self-contained is worth the small redundancy. Any change here must be
// replicated there.
//
// `req.ip` backs the /health rate-limit key in rateLimit.ts (POST /title keys
// on the JWT `sub` instead) and the remoteAddress field in logSerializers.ts.
// Two directions have to hold at once:
//
//   - Trusting too little collapses the IP-keyed bucket to a single key — the
//     Nginx container address — so one caller spends the budget for everyone.
//     fastify 5.12.1, the fix for GHSA-3m5p-2c4r-xxw2, made `trustProxy:
//     <number>` fail closed for exactly this reason: a hop count cannot
//     validate the immediate peer. The regression is silent — no error, and
//     no existing test observes the resolved address.
//
//   - Trusting too much (`trustProxy: true`) lets any client forge
//     X-Forwarded-For and so forge both the rate-limit key and the audit trail.

// The fetcher publishes no host port and sits alone with Nginx on
// `metadata_net`, so a 172.16/12 address stands in for the front-door proxy.
// PUBLIC_PEER is the shape a direct client would have if that stopped
// being true.
const DOCKER_PEER = '172.19.0.4';
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

describe('TRUST_PROXY peer validation', () => {
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
