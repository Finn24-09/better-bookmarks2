// Pino redaction paths. The metadata-fetcher accepts user-supplied URLs and
// fetches them server-side; the target URL is the single most sensitive piece
// of data flowing through. The Fastify default error serializer attaches full
// `req.headers` (including bearer JWT) and `req.body` to every err object the
// global error handler logs — without explicit redaction those secrets reach
// container stdout.
//
// NOTE on `*` semantics: pino's `*` wildcard matches exactly ONE path segment.
// `req.body.url` covers the canonical case; `req.body.*.url` covers nested
// objects in case a future caller wraps the body. `err.input` is set by some
// Node error subclasses (e.g. URL parsing errors).

export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  'req.body.url',
  'req.body.*.url',
  'err.input',
  'err.config.url',
  'err.request.url',
] as const;
