import { describe, it, expect } from 'vitest';
import { registry, requestsTotal, OUTCOMES } from './metrics.js';

describe('metrics', () => {
  it('exposes prometheus text-format content type and a non-empty body', async () => {
    const contentType = registry.contentType;
    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=0.0.4');

    const body = await registry.metrics();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('# HELP');
  });

  it('includes default Node metrics', async () => {
    const body = await registry.metrics();
    expect(body).toMatch(/nodejs_/);
  });

  it('declares every outcome enum value with a stable label set', async () => {
    const body = await registry.metrics();
    for (const outcome of OUTCOMES) {
      expect(body).toContain(`metadata_fetcher_requests_total{outcome="${outcome}"}`);
    }
  });

  it('increments the requests counter for a given outcome', async () => {
    requestsTotal.labels('ok').inc();
    const body = await registry.metrics();
    // The outcome="ok" line must show at least 1 (more than the pre-init zero).
    const match = body.match(/metadata_fetcher_requests_total\{outcome="ok"\}\s+(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(1);
  });
});
