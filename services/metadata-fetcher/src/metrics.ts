import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

// Prometheus metrics for the metadata-fetcher. Internal-only — Nginx 404s any
// path under /api/title/ that is not the exact /api/title/ route, so /metrics
// is never reachable from outside the deployment.
//
// Labels are deliberately low-cardinality:
//   - `outcome`: closed enum (see OUTCOMES). No URLs, no hostnames, no IPs.
// Latency histograms expose timing but no per-request identifiers.

export const OUTCOMES = [
  'ok',
  'invalid-input',
  'blocked-host',          // every FetchBlockedError collapses here
  'content-type-rejected',
  'body-too-large',
  'compressed-body',
  'timeout',
  'upstream-error',
  'redirect-loop',
  'redirect-downgrade',
  'rate-limited',
  'concurrency-limited',
  'unauthorized',
  'email-not-verified',
] as const;

export type Outcome = typeof OUTCOMES[number];

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const requestsTotal = new Counter({
  name: 'metadata_fetcher_requests_total',
  help: 'Total POST /title requests grouped by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

// Pre-initialise every outcome to zero so Prometheus emits a stable label set.
for (const o of OUTCOMES) requestsTotal.labels(o).inc(0);

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export const dnsLatencySeconds = new Histogram({
  name: 'metadata_fetcher_dns_latency_seconds',
  help: 'DNS lookup latency for outbound fetches',
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

export const upstreamLatencySeconds = new Histogram({
  name: 'metadata_fetcher_upstream_latency_seconds',
  help: 'Total upstream fetch latency (DNS + connect + TLS + read)',
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

// Body-read termination counter. Lets operators detect a regression in the
// streaming early-stop on </head>: if `eof` starts dominating where
// `head-close` used to, the fetcher is reading more bytes than necessary
// and the cap is one bad change away from firing on real pages. Label
// values are a bounded enum — no cardinality risk.
export const BODY_TERMINATION_REASONS = ['head-close', 'body-open', 'eof'] as const;
export type BodyTerminationReasonLabel = typeof BODY_TERMINATION_REASONS[number];
export const bodyTerminationTotal = new Counter({
  name: 'metadata_fetcher_body_termination_total',
  help: 'How the body read for a successful fetch terminated',
  labelNames: ['reason'] as const,
  registers: [registry],
});
for (const r of BODY_TERMINATION_REASONS) bodyTerminationTotal.labels(r).inc(0);

// JWT email_verified claim state canary. Distinguishes "gate working as
// designed" (a healthy mix of true → ok and false → email-not-verified)
// from "gate misconfigured at the signer" (sudden 100% false). The
// 'missing' state is structurally unreachable because the verifier
// declares email_verified in requiredClaims, so a missing claim fails
// jose verification and falls into the 'unauthorized' OUTCOMES bucket
// before this counter is touched. Label set is exactly 'true' | 'false'.
export const JWT_EMAIL_VERIFIED_STATES = ['true', 'false'] as const;
export type JwtEmailVerifiedState = typeof JWT_EMAIL_VERIFIED_STATES[number];
export const jwtEmailVerifiedTotal = new Counter({
  name: 'metadata_fetcher_jwt_email_verified_total',
  help: 'Distribution of the email_verified claim across verified JWTs reaching the gate',
  labelNames: ['state'] as const,
  registers: [registry],
});
for (const s of JWT_EMAIL_VERIFIED_STATES) jwtEmailVerifiedTotal.labels(s).inc(0);
