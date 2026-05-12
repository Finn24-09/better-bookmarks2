// Pino redaction works on object property paths only — it cannot rewrite
// substrings inside string values. Secrets that travel in the URL query
// string (e.g. a debug `?token=…`) would otherwise land in container logs
// verbatim via fastify's default `req` serializer attaching `req.url`. This
// serializer rewrites the query component, replacing the values of
// known-sensitive parameters with [redacted].

export const REDACTED_QUERY_PARAMS = ['token', 'code'] as const;

export function scrubQueryString(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const hashIdx = url.indexOf('#');
  const noFragment = hashIdx < 0 ? url : url.slice(0, hashIdx);

  const qIdx = noFragment.indexOf('?');
  if (qIdx < 0) return noFragment;
  const path = noFragment.slice(0, qIdx);
  const rawQuery = noFragment.slice(qIdx + 1);

  // Treat `?` as an additional pair delimiter so a smuggled `foo=bar?token=X`
  // redacts the token rather than riding through inside the prior value.
  const retained: string[] = [];
  for (const pair of rawQuery.split(/[&?]/)) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    let key = rawKey;
    // Repeatedly percent-decode the key in case a hostile client obfuscated
    // the parameter name. Cap iterations to bound work.
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(key);
        if (next === key) break;
        key = next;
      } catch {
        break;
      }
    }
    if ((REDACTED_QUERY_PARAMS as readonly string[]).includes(key.toLowerCase())) {
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
  // Passes `raw.headers` through verbatim; masking of authorization/cookie is
  // performed by pino's `redact` config (LOG_REDACT_PATHS).
  const raw = req.raw ?? req;
  return {
    method: raw.method,
    url: scrubQueryString(raw.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    headers: raw.headers,
  };
}
