import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

const { verifyEmailTemplate } = await import('./verifyEmail.js');

const TOKEN = 'abcDEF123_-xyzQRS456_-tuvWXY789';

describe('verifyEmailTemplate', () => {
  it('returns the correct subject', () => {
    const out = verifyEmailTemplate(TOKEN);
    expect(out.subject).toBe('Verify your Better Bookmarks email address');
  });

  it('text body contains the verification link verbatim', () => {
    const out = verifyEmailTemplate(TOKEN);
    expect(out.text).toContain(`https://example.test/api/email/verify-email?token=${TOKEN}`);
  });

  it('html renders the link in both a CTA href and the fallback link box', () => {
    const out = verifyEmailTemplate(TOKEN);
    const link = `https://example.test/api/email/verify-email?token=${TOKEN}`;
    expect(out.html).toContain(`href="${link}"`);
    expect(out.html).toContain(`>${link}</a>`);
  });

  it('html includes the VML conditional with v:roundrect referencing the link', () => {
    const out = verifyEmailTemplate(TOKEN);
    const link = `https://example.test/api/email/verify-email?token=${TOKEN}`;
    expect(out.html).toContain('<!--[if mso]>');
    expect(out.html).toContain('<v:roundrect');
    expect(out.html).toContain(`href="${link}"`);
  });

  // C-6: prove esc() is a no-op on a safe base64url-shaped token. Includes
  // characters from the base64url alphabet that the URL-context pipeline
  // could be tempted to over-escape.
  it('safe base64url token survives byte-for-byte into the rendered HTML', () => {
    const safeTok = 'plain+token_-ABC=123';
    const out = verifyEmailTemplate(safeTok);
    const expected = `https://example.test/api/email/verify-email?token=${encodeURIComponent(safeTok)}`;
    expect(out.html).toContain(`href="${expected}"`);
    expect(out.html).not.toContain('&amp;amp;');
  });

  // Token-injection: the historic "raw <c>" / "raw &" leak test, kept as a
  // contract check (do NOT delete — this is a real client-compat invariant
  // and a test file independent of escape.test.ts that proves the
  // interpolation site is safe).
  it('html escapes &<>" via encodeURIComponent in the URL and never leaks raw metacharacters', () => {
    const dangerousToken = 'a&b<c>d"';
    const out = verifyEmailTemplate(dangerousToken);
    expect(out.html).not.toContain('a&b<c>d"');
    expect(out.html).not.toContain('<c>');
    expect(out.html).toContain('a%26b%3Cc%3Ed%22');
    expect(out.html).not.toContain('token=a&b');
  });

  // Coverage gap 1: CRLF injection in the token must not survive into HTML.
  it('CRLF in the token is encoded and never reaches the rendered HTML', () => {
    const out = verifyEmailTemplate('foo\r\nBcc: attacker@evil.com');
    expect(out.html).not.toContain('\r\n');
    expect(out.text).not.toContain('Bcc: attacker');
  });

  // Coverage gap 2: null byte / control characters.
  it('null bytes and low control bytes do not survive into HTML', () => {
    const out = verifyEmailTemplate('foo\x00bar\x01baz\x7fqux');
    expect(out.html).not.toContain('\x00');
    expect(out.html).not.toContain('\x01');
    expect(out.html).not.toContain('\x7f');
  });

  // Coverage gap 3: U+202E right-to-left override must be encoded, not
  // rendered verbatim. encodeURIComponent encodes it; we pin that here.
  it('U+202E right-to-left override is percent-encoded, not echoed', () => {
    const out = verifyEmailTemplate('foo‮bar');
    expect(out.html).not.toContain('‮');
    expect(out.html).toContain('%E2%80%AE');
  });

  // Coverage gap 5: very long input must not produce pathological output.
  it('very long token (10KB) renders without throwing and stays under 100KB', () => {
    const long = 'a'.repeat(10_000);
    const out = verifyEmailTemplate(long);
    expect(out.html.length).toBeLessThan(100_000);
    expect(out.html).toContain(long);
  });

  // Coverage gap 6: HTML/plaintext URL parity.
  it('HTML href URL matches the URL in the plaintext body', () => {
    const out = verifyEmailTemplate(TOKEN);
    const htmlMatch = out.html.match(/href="(https:\/\/[^"]+\/verify-email\?token=[^"]+)"/);
    expect(htmlMatch).not.toBeNull();
    const textMatch = out.text.match(/https:\/\/\S+\/verify-email\?token=\S+/);
    expect(textMatch).not.toBeNull();
    expect(htmlMatch![1]).toBe(textMatch![0]);
  });

  // Whole-template HTML snapshot — this replaces all the per-detail
  // gradient / rgba / count assertions (C-3). A snapshot diff is reviewable.
  it('renders the full HTML deterministically (snapshot)', () => {
    const out = verifyEmailTemplate(TOKEN);
    expect(out.html).toMatchSnapshot();
  });

  it('renders the full text body deterministically (snapshot)', () => {
    const out = verifyEmailTemplate(TOKEN);
    expect(out.text).toMatchSnapshot();
  });
});

// Coverage gap 4: javascript: scheme in APP_BASE_URL must collapse to
// about:blank in the rendered href.
describe('verifyEmailTemplate — APP_BASE_URL scheme rejection (gap 4)', () => {
  it('a javascript: APP_BASE_URL collapses to about:blank in href', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: { APP_BASE_URL: 'javascript:alert(1)' },
    }));
    const mod = await import('./verifyEmail.js');
    const out = mod.verifyEmailTemplate(TOKEN);
    expect(out.html).toContain('href="about:blank"');
    expect(out.html).not.toContain('javascript:alert(1)');
    vi.doUnmock('../config.js');
    vi.resetModules();
  });
});
