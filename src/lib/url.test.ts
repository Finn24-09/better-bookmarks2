import { describe, it, expect } from 'vitest';
import { parseHttpUrl } from './url';

describe('parseHttpUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com',
    'https://example.com/path?query=1#hash',
    'HTTPS://EXAMPLE.com/x', // URL constructor lowercases protocol
  ])('returns %s for valid http(s) URL', (input) => {
    expect(parseHttpUrl(input)).toBe(input);
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    ['file:///etc/passwd'],
    ['ftp://example.com/file'],
    ['mailto:a@b.com'],
    ['tel:+1234567890'],
    ['vbscript:MsgBox()'],
    ['not a url'],
    [''],
  ])('returns null for unsafe or malformed URL %s', (input) => {
    expect(parseHttpUrl(input)).toBeNull();
  });
});
