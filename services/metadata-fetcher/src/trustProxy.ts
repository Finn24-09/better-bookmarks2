// Which upstream peers are allowed to set X-Forwarded-For.
//
// Intentionally duplicated from services/email/src/trustProxy.ts — keeping
// each service self-contained is worth the small redundancy. Any change here
// must be replicated there.
//
// Lives in its own module because the value is a security invariant that both
// index.ts and the tests must agree on. When it was an inline literal, the
// tests carried their own copy and kept passing while production behaviour
// changed underneath them — see trustProxy.test.ts.
//
// The fetcher publishes no host port and shares `metadata_net` only with the
// front-door Nginx, so trusting the RFC1918 ranges trusts exactly that
// boundary and nothing a remote client can reach. `loopback` covers the
// container's own health probe and the Vite dev proxy.
//
// Do NOT use `true`: that trusts any X-Forwarded-For, letting a remote client
// forge their apparent IP for both audit logs and rate-limit keying.
//
// Do NOT use a hop count either. fastify 5.12.1 — the fix for
// GHSA-3m5p-2c4r-xxw2 — made numeric `trustProxy` fail closed, because a hop
// count cannot validate the immediate peer. Under 5.12.1+, `trustProxy: 1`
// silently resolves req.ip to the Nginx container address on every request,
// which collapses the IP-keyed /health bucket in rateLimit.ts into a single
// shared bucket and flattens remoteAddress in logSerializers.ts. POST /title
// keys on the JWT `sub` and so is unaffected, but the fallback path in
// userOrIpKey() is not.
//
// Adjust if the deployment puts additional reverse proxies in front of this
// service on a network outside these ranges.
export const TRUST_PROXY = 'loopback,uniquelocal';
