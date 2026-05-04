import { describe, it, expect } from 'vitest';
import { captureLog as rawCaptureLog } from './__test__/pinoCapture.js';
import { scrubQueryString } from './logSerializers.js';
import type { Logger } from 'pino';

// Real pino integration test for the custom `req` serializer. Pino's redact
// option matches object property paths only — it cannot rewrite a substring
// inside a string value. Tokens that arrive in the URL query string (e.g.
// /verify-email?token=…, /reset-password?token=…) would otherwise leak into
// container logs verbatim via fastify's default `req` serializer attaching
// `req.url`. The serializer under test rewrites the query component before
// pino sees it.
//
// Bind the shared helper with `withReqSerializer: true` so all tests in
// this file run pino with the serializer installed.
const captureLog = (fn: (logger: Logger) => void): string =>
  rawCaptureLog(fn, { withReqSerializer: true });

describe('reqSerializer — query-string token redaction', () => {
  it('redacts ?token=… while preserving the path', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/verify-email?token=SECRET_TOKEN_VALUE',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('SECRET_TOKEN_VALUE');
    expect(out).toContain('[redacted]');
    expect(out).toContain('/verify-email');
  });

  it('redacts ?code=… (allowlisted sensitive name)', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/auth/oauth?code=ABC123XYZ',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('ABC123XYZ');
    expect(out).toContain('[redacted]');
    expect(out).toContain('/auth/oauth');
  });

  it('redacts every instance when a sensitive param appears multiple times', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/x?token=AAA&foo=bar&token=BBB',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('AAA');
    expect(out).not.toContain('BBB');
    expect(out).toContain('foo=bar');
  });

  it('passes through requests with no query string unchanged', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/health',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).toContain('/health');
    expect(out).not.toContain('?');
  });

  it('preserves non-sensitive query parameters in full (positive control)', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/search?q=foo&limit=10&offset=20',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).toContain('q=foo');
    expect(out).toContain('limit=10');
    expect(out).toContain('offset=20');
    expect(out).not.toContain('[redacted]');
  });

  it('preserves the path component when only the token value is redacted', () => {
    // Direct unit assertion against the helper — the path must remain intact
    // so operators can identify which endpoint failed.
    expect(scrubQueryString('/verify-email?token=X')).toBe('/verify-email?token=[redacted]');
    expect(scrubQueryString('/reset-password?token=ABC&foo=bar')).toBe(
      '/reset-password?token=[redacted]&foo=bar',
    );
  });

  it('matches sensitive parameter names case-insensitively', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/x?Token=MIXED_CASE_VALUE',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('MIXED_CASE_VALUE');
    expect(out).toContain('[redacted]');
  });

  it('handles an empty query string cleanly', () => {
    // `/x?` — the question mark is present but the query is empty. The
    // serializer should not throw and should produce a sane URL value.
    expect(() => scrubQueryString('/x?')).not.toThrow();
    expect(scrubQueryString('/x?')).toBe('/x');
  });
});

describe('scrubQueryString — URL-encoded key bypass (round-4 hardening)', () => {
  it('redacts ?%74oken=SECRET (lowercase t percent-encoded)', () => {
    // %74 is `t` — without percent-decoding the key, `%74oken`.toLowerCase()
    // never matches `token` and the value passes through verbatim.
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/verify-email?%74oken=SECRET',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SECRET');
  });

  it('redacts ?T%6Fken=SECRET (mixed case with `o` percent-encoded)', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/verify-email?T%6Fken=SECRET',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SECRET');
  });

  it('redacts ?%63ode=SECRET (`code` with `c` percent-encoded)', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: {
            method: 'GET',
            url: '/auth/oauth?%63ode=SECRET',
            headers: {},
          },
        },
        'boom',
      ),
    );
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SECRET');
  });

  it('preserves the on-the-wire (encoded) key bytes when redacting', () => {
    // The redaction must keep the raw key spelling so an operator can see
    // the request shape — only the value is replaced.
    expect(scrubQueryString('/verify-email?%74oken=SECRET')).toBe(
      '/verify-email?%74oken=[redacted]',
    );
  });

  it('does not throw on malformed percent-encoding and falls back to raw key', () => {
    // `%XX` is an invalid percent-escape — decodeURIComponent throws. The
    // serializer must not throw, and since the raw key (`%XX`) is not in
    // the sensitive allowlist, the pair passes through unchanged.
    expect(() => scrubQueryString('/x?%XX=value')).not.toThrow();
    expect(scrubQueryString('/x?%XX=value')).toBe('/x?%XX=value');
  });
});

describe('scrubQueryString — multiple-? and fragment hardening (round-4)', () => {
  it('redacts an embedded ?token=… smuggled into a value (`foo=bar?token=SECRET`)', () => {
    // A non-conforming client can put a literal `?` inside the query.
    // Treat it as an additional pair delimiter so the smuggled token
    // doesn't ride through inside foo's value.
    const out = scrubQueryString('/x?foo=bar?token=SECRET');
    expect(out).toContain('foo=bar');
    expect(out).toContain('token=[redacted]');
    expect(out).not.toContain('SECRET');
  });

  it('handles ?foo=bar?token=A&baz=B — preserves siblings, redacts token', () => {
    const out = scrubQueryString('/x?foo=bar?token=A&baz=B');
    expect(out).toContain('foo=bar');
    expect(out).toContain('baz=B');
    expect(out).toContain('token=[redacted]');
    expect(out).not.toMatch(/token=A(?![A-Za-z0-9])/);
  });

  it('drops a `#fragment` on an otherwise-valid query', () => {
    const out = scrubQueryString('/path?token=X#fragment');
    expect(out).toBe('/path?token=[redacted]');
    expect(out).not.toContain('#fragment');
  });

  it('drops a fragment-only URL (no query at all)', () => {
    const out = scrubQueryString('/path#fragment-only');
    expect(out).toBe('/path');
    expect(out).not.toContain('#');
  });

  it('drops a fragment that itself smuggles a sensitive parameter', () => {
    // `#token=SECRET` should never enter the query parser and must not
    // leak. Defense-in-depth — standard HTTP servers strip fragments
    // before the application layer, but a synthetic client can fake it.
    const out = scrubQueryString('/path?foo=bar#token=SECRET');
    expect(out).toBe('/path?foo=bar');
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('#');
  });
});

describe('scrubQueryString — double-percent-encoding hardening', () => {
  // Background: a single percent-decode (round-4 hardening) closes
  // `?%74oken=…` (one-pass `%74` → `t`) but leaves `?%2574oken=…` open
  // because the first decode produces `%74oken`, which still doesn't
  // match the lowercase allowlist. Loop the decode until the value is
  // stable, with a small iteration cap to bound work.

  it('redacts ?%2574oken=SECRET (double-encoded `t`: %25 → %, then %74 → t)', () => {
    // First decode: %2574oken → %74oken (still encoded — would bypass
    // a single-pass decoder). Second decode: %74oken → token. Match.
    const out = scrubQueryString('/verify-email?%2574oken=SECRET');
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SECRET');
    // On-the-wire bytes preserved on the key side so an operator can
    // still see the obfuscation attempt in logs.
    expect(out).toBe('/verify-email?%2574oken=[redacted]');
  });

  it('redacts ?%252574oken=SECRET (triple-encoded — exactly at the 3-iteration cap)', () => {
    // %252574oken → %2574oken → %74oken → token, exactly 3 passes.
    const out = scrubQueryString('/verify-email?%252574oken=SECRET');
    expect(out).toContain('[redacted]');
    expect(out).not.toContain('SECRET');
    expect(out).toBe('/verify-email?%252574oken=[redacted]');
  });

  it('does NOT redact ?%25252574oken=SECRET (quadruple-encoded — exceeds 3-iteration cap)', () => {
    // Documents the explicit bound: %25252574oken needs 4 decode passes
    // to reach `token`. The cap stops at 3, so the key remains
    // `%2574oken` after the loop, which doesn't match the allowlist.
    // The pair therefore passes through unredacted. If a future engineer
    // wants to bump the cap, this assertion will fail and force a
    // discussion about the new bound.
    const out = scrubQueryString('/verify-email?%25252574oken=SECRET');
    expect(out).toBe('/verify-email?%25252574oken=SECRET');
  });

  it('redacts every value when multiple keys mix single, double, and decoded encodings', () => {
    // %2574oken (double) → token; plain `token`; %2563ode (double) → code.
    // All three values must be redacted; raw key bytes preserved on wire.
    const out = scrubQueryString('/x?%2574oken=A&token=B&%2563ode=C');
    expect(out).not.toContain('=A');
    expect(out).not.toContain('=B');
    expect(out).not.toContain('=C');
    expect(out).toContain('%2574oken=[redacted]');
    expect(out).toContain('token=[redacted]');
    expect(out).toContain('%2563ode=[redacted]');
  });

  it('does not throw and falls through unredacted on mid-decode malformed input (%25%XX=value)', () => {
    // First decode of `%25%XX` is malformed (`%XX` is invalid in any
    // pass after the first). The loop must catch the throw and bail
    // out; since the resulting key isn't in the allowlist the pair
    // passes through unchanged.
    expect(() => scrubQueryString('/x?%25%XX=value')).not.toThrow();
    expect(scrubQueryString('/x?%25%XX=value')).toBe('/x?%25%XX=value');
  });

  it('regression: stable already-decoded ?token=SECRET still redacts after the loop change', () => {
    // The loop must terminate immediately on stable input — first decode
    // of `token` is `token`, equal, so we break on iteration 0.
    const out = scrubQueryString('/verify-email?token=SECRET');
    expect(out).toBe('/verify-email?token=[redacted]');
  });
});
