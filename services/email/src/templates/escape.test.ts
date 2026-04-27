import { describe, it, expect } from 'vitest';
import { esc, safeUrl } from './escape.js';

describe('esc', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
    ['`', '&#96;'],
  ])('maps %s to %s', (input, expected) => {
    expect(esc(input)).toBe(expected);
  });

  it('replaces all metacharacters in a mixed string in a single pass', () => {
    expect(esc('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('replaces single quote and backtick alongside the original four in a mixed string', () => {
    expect(esc("a ' b ` c & d < e > f \"g\"")).toBe(
      'a &#39; b &#96; c &amp; d &lt; e &gt; f &quot;g&quot;',
    );
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

describe('safeUrl', () => {
  it('passes a plain https URL through (modulo trailing-slash normalization)', () => {
    expect(safeUrl('https://example.test/foo')).toMatch(/^https:\/\/example\.test\/foo/);
  });

  it('HTML-escapes & in query strings (proves esc runs on the result)', () => {
    expect(safeUrl('https://example.test/?q=a&b=c')).toContain('&amp;');
  });

  it('accepts http scheme', () => {
    expect(safeUrl('http://example.test/')).toMatch(/^http:\/\/example\.test\//);
  });

  it('returns about:blank for javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('about:blank');
  });

  it('returns about:blank for data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('about:blank');
  });

  it('returns about:blank for vbscript: scheme', () => {
    expect(safeUrl('vbscript:msgbox(1)')).toBe('about:blank');
  });

  it('returns about:blank for an uppercase JAVASCRIPT: scheme (URL parser normalizes protocol)', () => {
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('about:blank');
  });

  it('returns about:blank for garbage that is not a URL', () => {
    expect(safeUrl('not a url')).toBe('about:blank');
  });

  it('returns about:blank for an empty string', () => {
    expect(safeUrl('')).toBe('about:blank');
  });
});
