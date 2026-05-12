import dns from 'node:dns/promises';
import net from 'node:net';
import type { LookupAddress } from 'node:dns';
import { ipv4ToBigInt, ipv6ToBigInt, isIpv4Denied, isIpv6Denied } from './ipRanges.js';

// ---------------------------------------------------------------------------
// SSRF guard
//
// Pure validation module: given a URL string, returns either an accept
// (with a pre-resolved IP for the caller to dial directly) or a reject
// (with a typed reason). No HTTP I/O happens here.
//
// Defence layers in order:
//   1. URL parse + length cap.
//   2. Raw-string check for `%` in the host portion (catches percent-encoded
//      hostnames that the WHATWG URL parser would silently decode).
//   3. Scheme allowlist (http/https).
//   4. Userinfo rejection.
//   5. Hostname canonicalisation. Rejects non-dotted-quad IPv4 encodings
//      (decimal, hex with 0x prefix, octal with leading zero, dotless,
//      trailing-dot, double-dot, null injection) by requiring the TLD to
//      contain at least one letter, no labels of form `0x…` or `0\d+`.
//   6. Port allowlist (scheme-default only — 80 for http, 443 for https).
//   7. For IP literals (canonical IPv4 or bracketed IPv6) short-circuit DNS
//      and consult the deny-list directly. For DNS-shaped hostnames, resolve
//      all addresses, reject if ANY address is denied, dial the first.
// ---------------------------------------------------------------------------

export type ValidationResult =
  | {
      ok: true;
      scheme: 'http:' | 'https:';
      host: string;
      port: number;
      dialIp: string;
      dialFamily: 4 | 6;
      pathQuery: string;
    }
  | { ok: false; reason: ValidationFailReason };

export type ValidationFailReason =
  | 'invalid-url'
  | 'url-too-long'
  | 'unsupported-scheme'
  | 'userinfo-forbidden'
  | 'non-canonical-host'
  | 'port-not-allowed'
  | 'dns-failure'
  | 'blocked-ip';

const MAX_URL_LEN = 2000;

// Strict canonical dotted-quad IPv4 — rejects decimal, hex, octal, dotless,
// trailing-dot, etc. Node's net.isIPv4 is more permissive than we want.
const IPV4_CANONICAL_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

function defaultPort(scheme: 'http:' | 'https:'): number {
  return scheme === 'https:' ? 443 : 80;
}

function isPortAllowed(scheme: 'http:' | 'https:', port: number): boolean {
  return port === defaultPort(scheme);
}

/**
 * Detect a `%` byte in the host portion of the raw URL string. The WHATWG
 * URL parser percent-decodes hostnames (so `http://%65xample.com/` becomes
 * `example.com`), erasing the encoding before we can inspect it from
 * URL.hostname. We refuse any URL with percent-encoded host bytes as a
 * separate, pre-parse check.
 */
function rawHostHasPercent(raw: string): boolean {
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd < 0) return false;
  const afterScheme = raw.slice(schemeEnd + 3);
  const stop = afterScheme.search(/[/?#]/);
  const authorityPart = stop < 0 ? afterScheme : afterScheme.slice(0, stop);
  const afterAt = authorityPart.includes('@')
    ? authorityPart.slice(authorityPart.indexOf('@') + 1)
    : authorityPart;
  // Strip a possible trailing :port (last colon, but only when not inside
  // a bracketed IPv6 — we don't allow IP literals via percent-encoded form).
  const hostOnly = afterAt.startsWith('[')
    ? afterAt.slice(0, afterAt.indexOf(']') + 1)
    : afterAt.replace(/:\d+$/, '');
  return hostOnly.includes('%');
}

/**
 * Strict DNS-shaped hostname validator. Each label is `[a-z0-9-]+` between
 * 1 and 63 chars, doesn't start/end with `-`. Labels cannot be `0x…` (hex
 * IPv4 disguise) or `0\d+` (octal IPv4 disguise). The last label (TLD) must
 * contain at least one letter — this rejects single-label numeric encodings
 * (`2130706433`) and dot-numeric encodings (`127.1`, `0177.0.0.1`).
 */
function isCanonicalDnsHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (host.includes('..')) return false;
  if (host.endsWith('.')) return false;
  const labels = host.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) return false;
    if (/^0[xX][0-9a-fA-F]+$/.test(label)) return false;    // hex-IPv4 disguise
    if (/^0\d+$/.test(label)) return false;                  // octal-IPv4 disguise
  }
  const tld = labels[labels.length - 1];
  if (!/[a-z]/i.test(tld)) return false;
  return true;
}

export type Resolver = (host: string) => Promise<LookupAddress[]>;

const defaultResolver: Resolver = host =>
  dns.lookup(host, { all: true, verbatim: true });

function checkAddress(addr: LookupAddress): { ok: true } | { ok: false } {
  if (addr.family === 4) {
    if (!IPV4_CANONICAL_RE.test(addr.address)) return { ok: false };
    const big = ipv4ToBigInt(addr.address);
    if (isIpv4Denied(big)) return { ok: false };
    return { ok: true };
  }
  if (!net.isIPv6(addr.address)) return { ok: false };
  const v4MappedMatch = addr.address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch && IPV4_CANONICAL_RE.test(v4MappedMatch[1])) {
    const big = ipv4ToBigInt(v4MappedMatch[1]);
    if (isIpv4Denied(big)) return { ok: false };
  }
  const big = ipv6ToBigInt(addr.address);
  if (isIpv6Denied(big)) return { ok: false };
  return { ok: true };
}

export async function validateUrl(
  raw: string,
  resolver: Resolver = defaultResolver,
): Promise<ValidationResult> {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'invalid-url' };
  if (raw.length > MAX_URL_LEN) return { ok: false, reason: 'url-too-long' };

  // Pre-parse: refuse percent-encoded hosts. URL parsing would silently
  // decode them, hiding the obfuscation from the rest of the pipeline.
  if (rawHostHasPercent(raw)) return { ok: false, reason: 'non-canonical-host' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: 'unsupported-scheme' };
  if (url.username || url.password) return { ok: false, reason: 'userinfo-forbidden' };

  const scheme = url.protocol as 'http:' | 'https:';
  const rawHost = url.hostname;

  const isV4Literal = IPV4_CANONICAL_RE.test(rawHost);
  // URL.hostname strips IPv6 brackets, so use net.isIPv6 directly.
  const isV6Literal = net.isIPv6(rawHost);
  const isDnsHost = !isV4Literal && !isV6Literal && isCanonicalDnsHostname(rawHost);
  if (!isV4Literal && !isV6Literal && !isDnsHost) {
    return { ok: false, reason: 'non-canonical-host' };
  }

  const port = url.port === '' ? defaultPort(scheme) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: 'port-not-allowed' };
  }
  if (!isPortAllowed(scheme, port)) return { ok: false, reason: 'port-not-allowed' };

  // IP literal short-circuit. The literal IS the address — no DNS needed.
  if (isV4Literal) {
    const big = ipv4ToBigInt(rawHost);
    if (isIpv4Denied(big)) return { ok: false, reason: 'blocked-ip' };
    return {
      ok: true, scheme, host: rawHost, port,
      dialIp: rawHost, dialFamily: 4,
      pathQuery: url.pathname + url.search,
    };
  }
  if (isV6Literal) {
    // IPv4-mapped check.
    const v4MappedMatch = rawHost.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedMatch && IPV4_CANONICAL_RE.test(v4MappedMatch[1])) {
      const big = ipv4ToBigInt(v4MappedMatch[1]);
      if (isIpv4Denied(big)) return { ok: false, reason: 'blocked-ip' };
    }
    const big = ipv6ToBigInt(rawHost);
    if (isIpv6Denied(big)) return { ok: false, reason: 'blocked-ip' };
    return {
      ok: true, scheme, host: rawHost, port,
      dialIp: rawHost, dialFamily: 6,
      pathQuery: url.pathname + url.search,
    };
  }

  // DNS path.
  let addrs: LookupAddress[];
  try {
    addrs = await resolver(rawHost);
  } catch {
    return { ok: false, reason: 'dns-failure' };
  }
  if (!addrs.length) return { ok: false, reason: 'dns-failure' };

  // Any-address-private = reject. A DNS server returning a mix of public
  // and private answers is treated as hostile.
  for (const a of addrs) {
    if (!checkAddress(a).ok) return { ok: false, reason: 'blocked-ip' };
  }

  const dial = addrs[0];
  return {
    ok: true,
    scheme,
    host: rawHost,
    port,
    dialIp: dial.address,
    dialFamily: dial.family === 6 ? 6 : 4,
    pathQuery: url.pathname + url.search,
  };
}
