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
  'blocked-scheme',
  'blocked-userinfo',
  'blocked-port',
  'blocked-host',
  'blocked-ip',
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
