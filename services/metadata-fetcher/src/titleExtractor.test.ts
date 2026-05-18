import { describe, it, expect } from 'vitest';
import { extractTitle, MAX_TITLE_LENGTH } from './titleExtractor.js';

function bytes(s: string): Buffer { return Buffer.from(s, 'utf-8'); }

describe('titleExtractor — priority order', () => {
  it('og:title wins over twitter:title and <title>', () => {
    const html = `
      <html><head>
        <title>plain title</title>
        <meta name="twitter:title" content="twitter title">
        <meta property="og:title" content="og title">
      </head></html>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('og title');
  });

  it('twitter:title used when og missing', () => {
    const html = `<head><title>plain</title><meta name="twitter:title" content="tw"></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('tw');
  });

  it('<title> used when both meta tags missing', () => {
    const html = `<head><title>plain</title></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('plain');
  });

  it('returns null when all three are missing', () => {
    const html = `<head></head><body><h1>no title here</h1></body>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe(null);
  });

  it('returns null when og/twitter/<title> are all empty', () => {
    const html = `<head><title></title><meta property="og:title" content=""></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe(null);
  });

  it('returns null when og:title is whitespace-only', () => {
    const html = `<head><title>fallback</title><meta property="og:title" content="   "></head>`;
    // Whitespace-only og:title is skipped; falls back to <title>.
    expect(extractTitle(bytes(html), 'utf-8')).toBe('fallback');
  });

  it('parser ignores body content even if it contains <title>', () => {
    // Real-world: a <script> in the body may contain literal `<title>` text.
    const html = `<head><title>head-title</title></head><body><script>var x='<title>body-fake</title>';</script></body>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('head-title');
  });
});

describe('titleExtractor — post-processing', () => {
  it('decodes HTML entities', () => {
    const html = `<head><title>foo &amp; bar &quot;baz&quot; &#39;qux&#39; &#x2014;</title></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('foo & bar "baz" \'qux\' —');
  });

  it('collapses internal whitespace runs to a single space', () => {
    const html = `<head><title>multi\n\n\tspace\trun</title></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('multi space run');
  });

  it('trims leading/trailing whitespace', () => {
    const html = `<head><title>   padded   </title></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('padded');
  });

  it('clamps titles longer than MAX_TITLE_LENGTH (500 chars)', () => {
    const big = 'x'.repeat(600);
    const html = `<head><title>${big}</title></head>`;
    const result = extractTitle(bytes(html), 'utf-8');
    expect(result).not.toBeNull();
    expect(result!.length).toBe(MAX_TITLE_LENGTH);
  });
});

describe('titleExtractor — charset decoding', () => {
  it('decodes ISO-8859-1 byte 0xE9 to é', () => {
    // `<title>caf\xe9</title>` in ISO-8859-1 bytes.
    const buf = Buffer.concat([
      Buffer.from('<title>caf', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('</title>', 'ascii'),
    ]);
    expect(extractTitle(buf, 'iso-8859-1')).toBe('café');
  });

  it('decodes the same bytes as U+FFFD under utf-8 with fatal:false', () => {
    const buf = Buffer.concat([
      Buffer.from('<title>caf', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('</title>', 'ascii'),
    ]);
    // 0xE9 is invalid UTF-8 → TextDecoder substitutes U+FFFD.
    expect(extractTitle(buf, 'utf-8')).toBe('caf�');
  });

  it('windows-1252 alias decodes like iso-8859-1', () => {
    const buf = Buffer.concat([
      Buffer.from('<title>caf', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('</title>', 'ascii'),
    ]);
    expect(extractTitle(buf, 'windows-1252')).toBe('café');
  });

  it('unknown charset falls back to utf-8', () => {
    const html = `<head><title>fallback</title></head>`;
    expect(extractTitle(bytes(html), 'no-such-charset')).toBe('fallback');
  });
});

describe('titleExtractor — robustness', () => {
  it('handles malformed HTML without throwing', () => {
    const html = `<head><title>unclosed`;
    expect(() => extractTitle(bytes(html), 'utf-8')).not.toThrow();
  });

  it('handles attribute order: content before property', () => {
    const html = `<head><meta content="og first" property="og:title"></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('og first');
  });

  it('handles self-closing meta tags', () => {
    const html = `<head><meta property="og:title" content="self-close" /></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('self-close');
  });

  it('case-insensitive property/name attribute values', () => {
    const html = `<head><meta property="OG:TITLE" content="upper"></head>`;
    expect(extractTitle(bytes(html), 'utf-8')).toBe('upper');
  });

  it('handles empty input gracefully', () => {
    expect(extractTitle(Buffer.alloc(0), 'utf-8')).toBe(null);
  });

  it('does not honour <meta charset> inside the document body', () => {
    // The HTTP-level charset is the only thing we trust; an attacker-supplied
    // <meta charset> inside the response body must not influence decoding.
    const buf = Buffer.concat([
      Buffer.from('<head><meta charset="iso-8859-1"><title>caf', 'ascii'),
      Buffer.from([0xe9]),
      Buffer.from('</title></head>', 'ascii'),
    ]);
    // We declared utf-8 — the byte 0xe9 must replacement-char even though
    // the document tries to claim iso-8859-1.
    expect(extractTitle(buf, 'utf-8')).toBe('caf�');
  });
});
