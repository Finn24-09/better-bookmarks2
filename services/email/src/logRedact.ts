// SEC: pino redaction paths. Without this, fastify's default error
// serializer attaches full `req.headers` (including the bearer JWT in
// authorization and the signed session cookie) to every err object the
// global error handler logs, plus any password/token field that happens
// to land in a request body. Redaction prevents those secrets from
// being written to container stdout — the most common log exfiltration
// surface in compromised hosts and shared-tenant logging stacks.
//
// IMPORTANT: pino's `*` wildcard matches exactly ONE path segment. So
// `*.password` matches `foo.password` but NOT `req.body.password` (the
// latter needs `*.*.password` or the explicit path). The wildcards are
// kept as a defence-in-depth net for top-level shapes like
// `{ password }` or `{ err: { password } }`, but the explicit
// `req.body.*` paths below are the ones that actually catch the most
// common case (a password/token field inside a Fastify request body).
// This is verified by the integration test in `logRedact.test.ts` —
// removing any one of the `req.body.*` entries fails a redaction
// assertion against real pino output.
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.new_password',
  '*.current_password',
  '*.token',
  '*.email_token',
  'req.body.password',
  'req.body.new_password',
  'req.body.current_password',
  'req.body.token',
] as const;
