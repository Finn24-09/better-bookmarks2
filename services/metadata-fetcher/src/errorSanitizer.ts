// Error-chain sanitiser. Before pino logs an error, scrub any URL, IPv4
// address, IPv6 address, or in-flight hostname out of every Error.message
// in the err.cause chain. This closes the leak path that pino's `redact`
// cannot reach — redact only matches object property paths, not substrings
// inside string values, so an error.message like
// `getaddrinfo ENOTFOUND victim.example.com` would otherwise reach stdout.

const URL_RE = /\b(?:https?:\/\/)[^\s"']+/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Permissive IPv6 — hex groups may be empty (`::` shorthand), at least 2
// colons required. Over-redaction is preferred to leakage; any false
// positive on `::` in random text is acceptable.
const IPV6_RE = /(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}/g;

const MAX_DEPTH = 5;

function scrubString(s: string, hostname: string | null): string {
  let out = s.replace(URL_RE, '[redacted-url]');
  out = out.replace(IPV6_RE, '[redacted-ip]');
  out = out.replace(IPV4_RE, '[redacted-ip]');
  if (hostname && hostname.length > 0) {
    const esc = hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), '[redacted-host]');
  }
  return out;
}

/**
 * Walk an Error's `cause` chain (depth-capped) and scrub sensitive strings
 * from each `message` and `input` field. Mutates in place because pino
 * serialises whatever object we pass it — returning a copy would not help
 * if the caller's reference still points at the unsanitised error.
 */
export function sanitizeErrorChain(err: unknown, hostname: string | null): void {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_DEPTH && current; depth++) {
    if (current instanceof Error) {
      if (typeof current.message === 'string') {
        current.message = scrubString(current.message, hostname);
      }
      const withInput = current as { input?: unknown };
      if (typeof withInput.input === 'string') {
        withInput.input = scrubString(withInput.input, hostname);
      }
      const withCause = current as { cause?: unknown };
      current = withCause.cause;
    } else {
      break;
    }
  }
}
