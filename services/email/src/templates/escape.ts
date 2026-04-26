/**
 * Escape the four HTML metacharacters that can break out of attribute or text contexts.
 *
 * Single-pass replace — apply exactly once at each interpolation site. NOT idempotent:
 * a second pass will turn `&amp;` into `&amp;amp;`. Today's interpolated values
 * (base64url tokens, constructed URLs) contain none of these characters, so this
 * is purely defensive against future template inputs.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]!);
}
