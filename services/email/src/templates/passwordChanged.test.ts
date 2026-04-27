import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

const { passwordChangedTemplate } = await import('./passwordChanged.js');

// Fixed timestamp used across the suite so locale-formatted strings are
// deterministic. UTC is required (C-2): the rendered "When" cell must be
// pinned to UTC, not whatever the test runner's local TZ happens to be.
const FIXED_DATE = new Date('2026-04-27T09:14:00Z');

describe('passwordChangedTemplate', () => {
  it('returns the correct subject', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.subject).toBe('Your Better Bookmarks password was changed');
  });

  // C-3: contract checks only — chrome / branding lives in _shared.test.ts
  // and inline-snapshot below. This file only asserts behaviour unique to
  // this template (timestamp formatting, login-URL CTA, S-3 privacy).

  // C-5: broaden the "no reply" check from the literal "reply to this email"
  // string to any \breply\b occurrence in either body.
  it('html and text body never instruct the recipient to reply', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html.toLowerCase()).not.toMatch(/\breply\b/);
    expect(out.text.toLowerCase()).not.toMatch(/\breply\b/);
  });

  it('does NOT include the misleading prior CTAs (Secure my account / Wasn\'t you?)', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).not.toContain('Secure my account');
    expect(out.html).not.toContain("Wasn't you?");
  });

  it('shows a "Didn\'t change your password?" advisory pointing at /login', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).toContain("Didn't change your password?");
    expect(out.html.toLowerCase()).toContain('forgot password');
    expect(out.html).toContain('href="https://example.test/login"');
  });

  it('text body confirms the change AND describes the forgot-password recovery', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.text).toContain('password was successfully changed');
    expect(out.text.toLowerCase()).toContain('forgot password');
    expect(out.text).toContain('https://example.test/login');
    expect(out.text.toLowerCase()).not.toContain('contact support');
    expect(out.text.toLowerCase()).not.toContain('secure your account');
  });

  // C-2: timestamp is pinned to UTC and the "UTC" label survives into the
  // HTML body. Recipient must be able to compare the rendered timestamp to
  // their own clock without guessing the server's TZ.
  it('renders the When cell formatted in UTC with a UTC label', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).toContain('>When<');
    // A locale string formatted with timeZone:UTC + timeZoneName:short ends
    // in "UTC". The literal "UTC" substring is the regression handle.
    expect(out.html).toContain('UTC');
    // 09:14 UTC is the actual hour; if anyone removes the timeZone option
    // the rendered hour will drift to the host TZ and this assertion fails.
    expect(out.html).toMatch(/9:14|09:14/);
    expect(out.html).toMatch(/Apr.*2026|2026.*Apr/);
  });

  // C-2: plaintext gets an unambiguous ISO-8601 string with trailing Z.
  it('text body includes an ISO-8601 timestamp with trailing Z', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.text).toContain('2026-04-27T09:14:00.000Z');
  });

  // S-3: the body must never re-disclose the recipient's email address.
  // The To: header already carries it.
  it('does NOT render an Account meta cell or any email-shaped string in the body', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).not.toContain('>Account<');
    expect(out.html).not.toMatch(/[\w.+-]+@[\w.-]+/);
    expect(out.text).not.toMatch(/[\w.+-]+@[\w.-]+/);
  });

  // C-6: prove esc() is a no-op on safe inputs and that the constructed
  // login URL survives byte-for-byte into the rendered HTML.
  it('plain ASCII login URL renders byte-for-byte (no double-escape)', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).toContain('https://example.test/login');
    // Negative: a double-pass through esc() would turn "&" in any future
    // query string into "&amp;amp;". No such sequence may appear.
    expect(out.html).not.toContain('&amp;amp;');
  });

  // Coverage gap 6: HTML/plaintext URL parity — the loginUrl in the HTML
  // must match the loginUrl in the plaintext body.
  it('login URL in HTML href matches the login URL in plaintext', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    const htmlMatch = out.html.match(/href="(https:\/\/[^"]+\/login)"/);
    expect(htmlMatch).not.toBeNull();
    const textMatch = out.text.match(/https:\/\/\S+\/login/);
    expect(textMatch).not.toBeNull();
    expect(htmlMatch![1]).toBe(textMatch![0]);
  });

  // Coverage gap 1: CRLF injection through changedAt must not survive into
  // the rendered HTML. Date.toLocaleString never emits \r\n, but pin it.
  it('CRLF in the formatted timestamp never reaches the rendered HTML', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).not.toContain('\r\n');
    expect(out.text).not.toContain('\r\n');
  });

  // Whole-template snapshot — protects future structural drift. A snapshot
  // diff is reviewable; a 30-line list of "expect contains gradient string"
  // assertions is not (C-3).
  it('renders the full HTML deterministically (snapshot)', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).toMatchSnapshot();
  });

  it('renders the full text body deterministically (snapshot)', () => {
    const out = passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.text).toMatchSnapshot();
  });
});

// Coverage gap 4: javascript: / data: schemes must collapse to about:blank
// inside the rendered href. Per-file vi.doMock + dynamic import so the
// override is local to this describe block.
describe('passwordChangedTemplate — APP_BASE_URL scheme rejection (gap 4)', () => {
  it('a javascript: APP_BASE_URL collapses to about:blank in href', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: { APP_BASE_URL: 'javascript:alert(1)' },
    }));
    const mod = await import('./passwordChanged.js');
    const out = mod.passwordChangedTemplate({ changedAt: FIXED_DATE });
    expect(out.html).toContain('href="about:blank"');
    expect(out.html).not.toContain('javascript:alert(1)');
    vi.doUnmock('../config.js');
    vi.resetModules();
  });
});
