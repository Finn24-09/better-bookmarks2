import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

const { resetPasswordTemplate } = await import('./resetPassword.js');

const TOKEN = 'abcDEF123_-xyzQRS456';

const DATA_LOSS_WARNING =
  'WARNING: Resetting your password will permanently delete all your bookmarks, tags, and thumbnails. ' +
  'This cannot be undone. Your data is encrypted with a key derived from your password — a new password creates an irrecoverable new key.';

describe('resetPasswordTemplate', () => {
  it('returns the correct subject', () => {
    const out = resetPasswordTemplate(TOKEN);
    expect(out.subject).toBe('Reset your Better Bookmarks password');
  });

  it('text body contains the reset link verbatim and the data-loss warning', () => {
    const out = resetPasswordTemplate(TOKEN);
    expect(out.text).toContain(`https://example.test/api/email/reset-password?token=${TOKEN}`);
    expect(out.text).toContain(DATA_LOSS_WARNING);
  });

  it('html renders the link in both a CTA href and the fallback link box', () => {
    const out = resetPasswordTemplate(TOKEN);
    const link = `https://example.test/api/email/reset-password?token=${TOKEN}`;
    expect(out.html).toContain(`href="${link}"`);
    expect(out.html).toContain(`>${link}</a>`);
  });

  it('html includes the VML conditional with v:roundrect referencing the link', () => {
    const out = resetPasswordTemplate(TOKEN);
    const link = `https://example.test/api/email/reset-password?token=${TOKEN}`;
    expect(out.html).toContain('<!--[if mso]>');
    expect(out.html).toContain('<v:roundrect');
    expect(out.html).toContain(`href="${link}"`);
  });

  // Security-functional UX: the data-loss callout MUST stay verbatim.
  // Removing or rewording this is a real product regression — it is the
  // only way the user learns that a forgot-password reset wipes all data.
  it('html includes the data-loss warning sentence verbatim', () => {
    const out = resetPasswordTemplate(TOKEN);
    expect(out.html).toContain(DATA_LOSS_WARNING);
  });

  it('html CTA label is exactly "Reset password (deletes all data)"', () => {
    const out = resetPasswordTemplate(TOKEN);
    expect(out.html).toContain('Reset password (deletes all data)');
  });

  // C-6: prove esc() is a no-op on a safe base64url-shaped token.
  it('safe base64url token survives byte-for-byte into the rendered HTML', () => {
    const safeTok = 'plain+token_-ABC=123';
    const out = resetPasswordTemplate(safeTok);
    const expected = `https://example.test/api/email/reset-password?token=${encodeURIComponent(safeTok)}`;
    expect(out.html).toContain(`href="${expected}"`);
    expect(out.html).not.toContain('&amp;amp;');
  });

  it('html escapes &<>" and never leaks raw metacharacters', () => {
    const dangerousToken = 'a&b<c>d"';
    const out = resetPasswordTemplate(dangerousToken);
    expect(out.html).not.toContain('a&b<c>d"');
    expect(out.html).not.toContain('<c>');
    expect(out.html).toContain('a%26b%3Cc%3Ed%22');
  });

  // Coverage gap 1: CRLF injection.
  it('CRLF in the token never reaches the rendered HTML', () => {
    const out = resetPasswordTemplate('foo\r\nBcc: attacker@evil.com');
    expect(out.html).not.toContain('\r\n');
    expect(out.text).not.toContain('Bcc: attacker');
  });

  // Coverage gap 2: control bytes.
  it('null bytes and low control bytes do not survive into HTML', () => {
    const out = resetPasswordTemplate('foo\x00bar\x01baz\x7fqux');
    expect(out.html).not.toContain('\x00');
    expect(out.html).not.toContain('\x01');
    expect(out.html).not.toContain('\x7f');
  });

  // Coverage gap 3: U+202E.
  it('U+202E right-to-left override is percent-encoded, not echoed', () => {
    const out = resetPasswordTemplate('foo‮bar');
    expect(out.html).not.toContain('‮');
    expect(out.html).toContain('%E2%80%AE');
  });

  // Coverage gap 5: very long input.
  it('very long token (10KB) renders without throwing and stays under 100KB', () => {
    const long = 'a'.repeat(10_000);
    const out = resetPasswordTemplate(long);
    expect(out.html.length).toBeLessThan(100_000);
    expect(out.html).toContain(long);
  });

  // Coverage gap 6: HTML/plaintext URL parity.
  it('HTML href URL matches the URL in the plaintext body', () => {
    const out = resetPasswordTemplate(TOKEN);
    const htmlMatch = out.html.match(/href="(https:\/\/[^"]+\/reset-password\?token=[^"]+)"/);
    expect(htmlMatch).not.toBeNull();
    const textMatch = out.text.match(/https:\/\/\S+\/reset-password\?token=\S+/);
    expect(textMatch).not.toBeNull();
    expect(htmlMatch![1]).toBe(textMatch![0]);
  });

  it('renders the full HTML deterministically (snapshot)', () => {
    const out = resetPasswordTemplate(TOKEN);
    expect(out.html).toMatchSnapshot();
  });

  it('renders the full text body deterministically (snapshot)', () => {
    const out = resetPasswordTemplate(TOKEN);
    expect(out.text).toMatchSnapshot();
  });
});

// Coverage gap 4: javascript: scheme rejection.
describe('resetPasswordTemplate — APP_BASE_URL scheme rejection (gap 4)', () => {
  it('a javascript: APP_BASE_URL collapses to about:blank in href', async () => {
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      config: { APP_BASE_URL: 'javascript:alert(1)' },
    }));
    const mod = await import('./resetPassword.js');
    const out = mod.resetPasswordTemplate(TOKEN);
    expect(out.html).toContain('href="about:blank"');
    expect(out.html).not.toContain('javascript:alert(1)');
    vi.doUnmock('../config.js');
    vi.resetModules();
  });
});
