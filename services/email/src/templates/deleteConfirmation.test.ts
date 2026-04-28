import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

const { deleteConfirmationTemplate } = await import('./deleteConfirmation.js');

const TOKEN = 'abcDEF123_-xyzQRS456_-tuvWXY789';

describe('deleteConfirmationTemplate', () => {
  it('returns the correct subject', () => {
    const out = deleteConfirmationTemplate(TOKEN);
    expect(out.subject).toBe('Confirm your Better Bookmarks account deletion');
  });

  it('text body contains the deletion token verbatim', () => {
    const out = deleteConfirmationTemplate(TOKEN);
    expect(out.text).toContain(TOKEN);
  });

  it('html renders the token in the visible token block with word-break wrapping', () => {
    const out = deleteConfirmationTemplate(TOKEN);
    expect(out.html).toContain(TOKEN);
    expect(out.html).toContain('word-break:break-all');
  });

  // C-6: prove esc() is a no-op on a safe base64url-shaped token. This is
  // the integration handle that catches "esc applied twice" downstream of
  // the template surface.
  it('safe base64url token survives byte-for-byte into the rendered HTML', () => {
    const safeTok = 'plain+token_-ABC=123';
    const out = deleteConfirmationTemplate(safeTok);
    expect(out.html).toContain(safeTok);
    expect(out.html).not.toContain('&amp;amp;');
  });

  it('html escapes raw &<>" in the token and never leaks them verbatim', () => {
    const dangerousToken = 'a&b<c>d"';
    const out = deleteConfirmationTemplate(dangerousToken);
    expect(out.html).toContain('a&amp;b&lt;c&gt;d&quot;');
    expect(out.html).not.toContain('a&b<c>d"');
    expect(out.html).not.toContain('<c>');
  });

  // Coverage gap 1: CRLF injection. The "header injection" threat only
  // materialises if the CR/LF bytes themselves survive — once they're
  // stripped, an attacker-controlled "Bcc:"-prefixed substring cannot
  // create a new header line, so the literal-byte assertion is the true
  // contract.
  it('CRLF in the token does not survive into HTML or text body', () => {
    const out = deleteConfirmationTemplate('foo\r\nBcc: attacker@evil.com');
    expect(out.html).not.toContain('\r\n');
    expect(out.html).not.toContain('\r');
    // The rendered token (extracted from the token block, surrounding
    // template whitespace trimmed) must not contain any \n — that would
    // be the only path for an attacker-supplied newline to survive into a
    // visible UI string.
    const tokenBlock = out.html.match(/<div class="token[^>]*>([\s\S]*?)<\/div>/);
    expect(tokenBlock).not.toBeNull();
    expect(tokenBlock![1].trim()).not.toContain('\n');
    expect(tokenBlock![1].trim()).toBe('fooBcc: attacker@evil.com');
  });

  // Coverage gap 2: control bytes.
  it('null bytes and low control bytes do not survive into HTML', () => {
    const out = deleteConfirmationTemplate('foo\x00bar\x01baz\x7fqux');
    expect(out.html).not.toContain('\x00');
    expect(out.html).not.toContain('\x01');
    expect(out.html).not.toContain('\x7f');
  });

  // Coverage gap 3: U+202E. The token is rendered as plaintext inside a
  // <div>, so we DO escape it via esc(); but esc() does not strip U+202E.
  // Instead we assert the literal codepoint never appears in the rendered
  // token block by asserting the rendered token survives encodeURIComponent
  // round-tripping. Pragmatic interpretation: esc() is the contract, and
  // U+202E is not a metachar — but the visible-display threat is real, so
  // we DO encode it for this template via esc-then-strip.
  it('U+202E right-to-left override is not echoed into the rendered HTML', () => {
    const out = deleteConfirmationTemplate('foo‮bar');
    expect(out.html).not.toContain('‮');
  });

  // Coverage gap 5: very long input.
  it('very long token (10KB) renders without throwing and stays under 100KB', () => {
    const long = 'a'.repeat(10_000);
    const out = deleteConfirmationTemplate(long);
    expect(out.html.length).toBeLessThan(100_000);
    expect(out.html).toContain(long);
  });

  // Whole-template snapshot — replaces the per-detail style assertions.
  it('renders the full HTML deterministically (snapshot)', () => {
    const out = deleteConfirmationTemplate(TOKEN);
    expect(out.html).toMatchSnapshot();
  });

  it('renders the full text body deterministically (snapshot)', () => {
    const out = deleteConfirmationTemplate(TOKEN);
    expect(out.text).toMatchSnapshot();
  });

  // ── M-5: stripUnsafe must be a no-op on real generated tokens ────────────
  // The display path strips characters; the compare path (hashToken) does
  // not. If the strip ever started removing real-token bytes, the email
  // would contain a token the server cannot validate. Guard against that
  // by asserting the strip is identity on the actual generator output.
  it('M-5: stripUnsafe is identity on crypto.randomBytes(32).toString("base64url") tokens', async () => {
    const { generateToken } = await import('../tokenUtils.js');
    for (let i = 0; i < 1000; i++) {
      const tok = generateToken();
      const out = deleteConfirmationTemplate(tok);
      // The unmodified token must appear verbatim in both rendered surfaces.
      expect(out.text).toContain(tok);
      expect(out.html).toContain(tok);
    }
  });
});
