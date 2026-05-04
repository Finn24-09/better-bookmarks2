// Pino redaction works on object property paths only — it cannot rewrite
// substrings inside a string value. Tokens and other secrets that travel
// in the URL query string (e.g. /verify-email?token=…, /reset-password?token=…)
// would otherwise land in container logs verbatim via fastify's default
// `req` serializer attaching `req.url`. This serializer rewrites the
// query component, replacing the values of known-sensitive parameters
// with [redacted] while keeping the path and other params intact for
// debugging.
//
// Allowlist-strip rather than blacklist-everything: an operator who
// loses path visibility on a 5xx loses critical debugging signal.

export const REDACTED_QUERY_PARAMS = ['token', 'code', 'reset_token', 'verify_token'] as const;

export function scrubQueryString(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  // Drop fragment first — should never appear in server-side req.url, but a
  // non-conforming client can synthesize it. We don't want to log it, and we
  // don't want it to ride past the parser carrying e.g. `#token=…`.
  const hashIdx = url.indexOf('#');
  const noFragment = hashIdx < 0 ? url : url.slice(0, hashIdx);

  const qIdx = noFragment.indexOf('?');
  if (qIdx < 0) return noFragment;
  const path = noFragment.slice(0, qIdx);
  const rawQuery = noFragment.slice(qIdx + 1);
  // Manual parse — URL/URLSearchParams require a base for relative URLs and
  // would re-encode characters in unexpected ways. The format here is the
  // tightly-controlled `key=value(&key=value)*` Fastify hands to the logger.
  //
  // A pair is normally delimited by `&`, but a hostile client may embed a
  // literal `?` inside the query string (e.g. `foo=bar?token=X`). Treat `?`
  // as an additional pair delimiter so the smuggled token redacts rather
  // than riding through inside the previous pair's value.
  const retained: string[] = [];
  for (const pair of rawQuery.split(/[&?]/)) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    // Repeatedly percent-decode the key until stable, in case a hostile
    // client double-encoded the parameter name (e.g. `%2574oken` →
    // `%74oken` → `token`). A single pass closes `?%74oken=…` but not
    // `?%2574oken=…` — the first decode there yields `%74oken`, which
    // still doesn't match the lowercase allowlist. Cap iterations at 3
    // to bound work; that covers all realistic obfuscation depths
    // (anything deeper has no plausible transport on the open web).
    let key = rawKey;
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(key);
        if (next === key) break; // stable — no more decoding needed
        key = next;
      } catch {
        // Malformed percent-encoding mid-decode — stop here and use the
        // current value. If the decoded-so-far form still doesn't match
        // the allowlist, the unmatched key passes through; the only
        // smuggling path that this could miss is a sensitive parameter
        // name whose obfuscation requires more than 3 decode passes,
        // which has no realistic transport.
        break;
      }
    }
    if ((REDACTED_QUERY_PARAMS as readonly string[]).includes(key.toLowerCase())) {
      // Emit the on-the-wire (possibly encoded) key bytes verbatim so an
      // operator can still see the request shape — only the value is masked.
      retained.push(`${rawKey}=[redacted]`);
    } else {
      retained.push(pair);
    }
  }
  return retained.length ? `${path}?${retained.join('&')}` : path;
}

interface RawRequestLike {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
}

export function reqSerializer(req: {
  raw?: RawRequestLike;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  ip?: string;
  hostname?: string;
}) {
  // SEC: this serializer deliberately passes `raw.headers` through verbatim
  // — including `authorization` and `cookie`. The masking of those header
  // values is performed by pino's `redact` config (see `LOG_REDACT_PATHS`
  // in `logRedact.ts`, wired up at the `serializers: { req: reqSerializer }`
  // call site in `index.ts`). If `redact` is ever removed or its
  // `req.headers.authorization` / `req.headers.cookie` paths are dropped,
  // this serializer will silently start dumping the bearer JWT and signed
  // session cookie into stdout. Keep the two sides in sync.
  // fastify wraps the raw node request; check both shapes for safety.
  const raw = req.raw ?? req;
  return {
    method: raw.method,
    url: scrubQueryString(raw.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    headers: raw.headers, // pino redact handles authorization/cookie inside this
  };
}
