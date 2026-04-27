/**
 * HTML entity-encode the six characters in the standard OWASP HTML Entity Encoding
 * set: `&`, `<`, `>`, `"`, `'`, and backtick. This is the safe primitive for
 * interpolating untrusted text into HTML text nodes and into both single- and
 * double-quoted attribute values. (Backtick is included because IE used to treat
 * it as an attribute delimiter; cheap defence-in-depth.)
 *
 * Single-pass replace — apply exactly once at each interpolation site. NOT idempotent:
 * a second pass will turn `&amp;` into `&amp;amp;`. Today's interpolated values
 * (base64url tokens, constructed URLs) contain none of these characters, so this
 * is purely defensive against future template inputs.
 *
 * NOTE: `esc()` is NOT a URL sanitiser. For values that flow into an `href`
 * attribute, use `safeUrl()` below — HTML escaping does not block dangerous
 * URL schemes such as `javascript:`, `data:`, or `vbscript:`.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function esc(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * Sanitise a value destined for an `href` (or any URL-bearing) attribute.
 *
 * Threat model: HTML-escaping alone is not sufficient for URL contexts. An
 * attacker who controls (or misconfigures) the URL value can otherwise inject
 * `javascript:`, `data:`, or `vbscript:` schemes — strings that pass through
 * `esc()` unchanged because they contain none of the HTML metacharacters, but
 * which trigger script execution when a recipient clicks the link in webmail
 * clients with permissive scheme handling. Email is a one-shot phishing
 * channel, so a clickable JS URL arriving from your own no-reply address is a
 * high-quality phishing payload.
 *
 * Contract:
 *  - The input is parsed with `new URL()`. Anything that cannot be parsed
 *    (relative URLs, garbage, empty string) collapses to the literal
 *    `'about:blank'` rather than rendering an attacker-controlled string.
 *  - Only `http:` and `https:` are accepted. The URL API normalises the
 *    `protocol` field to lowercase + trailing colon, so this check is
 *    parser-driven, not a substring match — `JAVASCRIPT:alert(1)` is rejected
 *    the same way `javascript:alert(1)` is.
 *  - The accepted, parsed URL is then run through `esc()` so the result is
 *    additionally safe to interpolate into a double-quoted HTML attribute
 *    (e.g. an `&` in a query string becomes `&amp;`).
 *
 * The `'about:blank'` fallback is deliberate: it is a well-known inert URL
 * that webmail clients render as a non-clickable placeholder. Future template
 * authors should reach for `safeUrl()` (not `esc()`) any time a value is
 * interpolated into an `href`, `src`, or other URL sink.
 */
export function safeUrl(u: string): string {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return 'about:blank';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'about:blank';
  }
  return esc(parsed.toString());
}
