// Shared test helper for pino integration tests. Extracted from inline
// duplicates in `logRedact.test.ts` and `logSerializers.test.ts`.
//
// The two test files exercise different layers:
//   - logRedact.test.ts logs request objects directly via `{req: ...}` and
//     relies only on pino's `redact` config to mask sensitive fields. It
//     does NOT want the `req` serializer running, because the serializer
//     drops `req.body` (intentional — bodies are too large for the access
//     log) which would defeat the test that proves passwords inside a
//     body get redacted.
//   - logSerializers.test.ts needs the `req` serializer to run so it can
//     verify URL query-string scrubbing.
//
// Hence the opt-in `withReqSerializer` flag. Default off matches the
// no-serializer behaviour of the original `logRedact.test.ts` helper.
import pino, { type Logger } from 'pino';
import { Writable } from 'node:stream';
import { LOG_REDACT_PATHS } from '../logRedact.js';
import { reqSerializer } from '../logSerializers.js';

export interface CaptureLogOptions {
  withReqSerializer?: boolean;
}

export function makeLogger(sink: Writable, opts: CaptureLogOptions = {}): Logger {
  const options: pino.LoggerOptions = {
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]' },
  };
  if (opts.withReqSerializer) {
    options.serializers = { req: reqSerializer };
  }
  return pino(options, sink);
}

export function captureLog(
  fn: (logger: Logger) => void,
  opts: CaptureLogOptions = {},
): string {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(c, _e, cb) {
      chunks.push(Buffer.from(c));
      cb();
    },
  });
  const logger = makeLogger(sink, opts);
  fn(logger);
  // Pino writes synchronously into a Writable today, but flush() makes the
  // contract explicit — don't depend on undocumented sync behaviour.
  if (typeof logger.flush === 'function') logger.flush();
  return Buffer.concat(chunks).toString('utf8');
}
