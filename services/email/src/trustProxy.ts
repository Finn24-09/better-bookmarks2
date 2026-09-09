// M-4: which upstream peers are allowed to set X-Forwarded-For.
//
// Lives in its own module because the value is a security invariant that both
// index.ts and the tests must agree on. When it was an inline literal, the
// tests carried their own copy and kept passing while production behaviour
// changed underneath them — see trustProxy.test.ts.
//
// The email service publishes no host port (docker-compose.yml), so the only
// peer that can open a socket to it is another container on the
// `betterbookmarks2` bridge network — in practice the front-door Nginx.
// Trusting the RFC1918 ranges therefore trusts exactly that boundary and
// nothing a remote client can reach. `loopback` covers the container's own
// health probe and `npm run dev` against a local proxy.
//
// Do NOT use `true`: that trusts any X-Forwarded-For, letting a remote client
// forge their apparent IP for both audit logs and rate-limit keying.
//
// Do NOT use a hop count either. fastify 5.12.1 — the fix for
// GHSA-3m5p-2c4r-xxw2 — made numeric `trustProxy` fail closed, because a hop
// count cannot validate the immediate peer. Under 5.12.1+, `trustProxy: 1`
// silently resolves req.ip to the Nginx container address on every request,
// which collapses every IP-keyed rate-limit bucket in rateLimit.ts into one
// shared bucket for the whole user base and flattens the requested_ip column
// on auth.email_tokens. It fails quietly: no error, and no type error either
// once the option is passed through a variable.
//
// Adjust if the deployment puts additional reverse proxies in front of this
// service on a network outside these ranges.
export const TRUST_PROXY = 'loopback,uniquelocal';
