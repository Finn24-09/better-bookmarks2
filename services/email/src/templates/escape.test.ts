import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { APP_BASE_URL: 'https://example.test' },
}));

import { esc } from './escape.js';
const { deleteConfirmationTemplate } = await import('./deleteConfirmation.js');
const { resetPasswordTemplate } = await import('./resetPassword.js');

describe('esc', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
  ])('maps %s to %s', (input, expected) => {
    expect(esc(input)).toBe(expected);
  });

  it('replaces all metacharacters in a mixed string in a single pass', () => {
    expect(esc('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('returns empty string unchanged', () => {
    expect(esc('')).toBe('');
  });

  it('leaves strings without metacharacters untouched', () => {
    expect(esc('plain-token_ABC123')).toBe('plain-token_ABC123');
  });

  it('is NOT idempotent — re-escaping double-escapes ampersands', () => {
    // Anyone "fixing" this to be idempotent is changing the contract.
    // esc() is meant to be applied exactly once at the interpolation site.
    expect(esc(esc('&'))).toBe('&amp;amp;');
  });
});

describe('template rendering for current safe inputs is unchanged after escape()', () => {
  // Safe inputs (base64url tokens, constructed URLs) contain none of &<>"
  // so applying esc() must not alter the rendered HTML/text.
  it('deleteConfirmationTemplate renders identically for a base64url token', () => {
    const token = 'abcDEF123_-xyzQRS456_-tuvWXY789';
    const out = deleteConfirmationTemplate(token);
    expect(out.subject).toBe('Confirm your Better Bookmarks account deletion');
    expect(out.text).toContain(token);
    expect(out.html).toContain(`<code style="display:block;color:#f9fafb;font-size:1em;word-break:break-all;letter-spacing:0.05em">${token}</code>`);
  });

  it('resetPasswordTemplate renders identically for a constructed URL', () => {
    const token = 'abcDEF123_-xyzQRS456';
    const out = resetPasswordTemplate(token);
    expect(out.subject).toBe('Reset your Better Bookmarks password');
    // Token in the URL is encodeURIComponent'd then esc'd; for base64url chars both are no-ops.
    expect(out.text).toContain(`/api/email/reset-password?token=${token}`);
    expect(out.html).toContain(`href="`);
    expect(out.html).toContain(`/api/email/reset-password?token=${token}`);
  });
});
