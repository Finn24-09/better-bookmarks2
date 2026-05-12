import { describe, it, expect } from 'vitest';
import { sanitizeErrorChain } from './errorSanitizer.js';

describe('sanitizeErrorChain', () => {
  it('scrubs URLs from err.message', () => {
    const err = new Error('failed: https://victim.example/secret/path?token=x');
    sanitizeErrorChain(err, null);
    expect(err.message).toBe('failed: [redacted-url]');
    expect(err.message).not.toContain('victim');
  });

  it('scrubs IPv4 addresses from err.message', () => {
    const err = new Error('connect ECONNREFUSED 192.0.2.5:443');
    sanitizeErrorChain(err, null);
    expect(err.message).not.toContain('192.0.2.5');
    expect(err.message).toContain('[redacted-ip]');
  });

  it('scrubs IPv6 addresses from err.message', () => {
    const err = new Error('connect ECONNREFUSED 2001:db8::1');
    sanitizeErrorChain(err, null);
    expect(err.message).not.toContain('2001:db8::1');
    expect(err.message).toContain('[redacted-ip]');
  });

  it('scrubs the in-flight hostname from err.message', () => {
    const err = new Error('getaddrinfo ENOTFOUND victim.example.com');
    sanitizeErrorChain(err, 'victim.example.com');
    expect(err.message).toContain('[redacted-host]');
    expect(err.message).not.toContain('victim');
  });

  it('walks the err.cause chain', () => {
    const cause = new Error('inner: 10.0.0.5');
    const outer = new Error('outer wrapper');
    (outer as { cause?: unknown }).cause = cause;
    sanitizeErrorChain(outer, null);
    expect((outer as { cause: Error }).cause.message).toContain('[redacted-ip]');
  });

  it('caps recursion at 5 levels', () => {
    // Build a 7-deep chain with an IP in the 6th and 7th level.
    let leaf = new Error('leaf: 10.0.0.5');
    let current = leaf;
    for (let i = 0; i < 6; i++) {
      const next = new Error(`wrapper-${i}`);
      (next as { cause?: unknown }).cause = current;
      current = next;
    }
    sanitizeErrorChain(current, null);
    // Levels 0..4 walked; level 5+ untouched. Confirm by walking ourselves.
    let probe: unknown = current;
    for (let i = 0; i <= 5; i++) probe = (probe as { cause?: unknown }).cause;
    // probe is now level 6 (leaf). It should still have 10.0.0.5.
    expect(probe instanceof Error).toBe(true);
    expect((probe as Error).message).toContain('10.0.0.5');
  });

  it('case-insensitive hostname scrub', () => {
    const err = new Error('TLS handshake failed for VICTIM.example.com');
    sanitizeErrorChain(err, 'victim.example.com');
    expect(err.message).not.toMatch(/victim/i);
  });

  it('scrubs from err.input field', () => {
    const err = new Error('parse failed') as Error & { input?: string };
    err.input = 'https://target.example/oops';
    sanitizeErrorChain(err, null);
    expect(err.input).toBe('[redacted-url]');
  });

  it('safe when err is not an Error', () => {
    expect(() => sanitizeErrorChain('a string', null)).not.toThrow();
    expect(() => sanitizeErrorChain(null, null)).not.toThrow();
    expect(() => sanitizeErrorChain(undefined, 'host.example')).not.toThrow();
  });

  it('safe with null hostname', () => {
    const err = new Error('no host context: 10.0.0.5');
    sanitizeErrorChain(err, null);
    expect(err.message).toContain('[redacted-ip]');
  });
});
