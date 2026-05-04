import { describe, it, expect } from 'vitest';
import { captureLog } from './__test__/pinoCapture.js';

// Real pino integration test. The earlier "is this string in the array?"
// shape of test was hollow: it didn't prove the redaction was actually
// wired into pino, nor that pino does anything useful with these paths.
// Here we run real pino with the real redact config, log real-looking
// payloads, and assert on the byte-level output. Removing a critical
// entry from LOG_REDACT_PATHS will fail one of these tests for the
// right reason — a secret leaks into the log line.
//
// We do NOT install the `req` serializer here — these tests want pino's
// raw redact behaviour, including against `req.body` which the serializer
// would strip out of the access-log shape. See `__test__/pinoCapture.ts`.

describe('LOG_REDACT_PATHS — pino redaction integration', () => {
  it('redacts a Bearer JWT in req.headers.authorization', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: { headers: { authorization: 'Bearer eyJ.SECRET.TOKEN', cookie: 'sid=signed' } },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('eyJ.SECRET.TOKEN');
    expect(out).toContain('[redacted]');
  });

  it('redacts the Cookie request header', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: { headers: { cookie: 'session=DO-NOT-LOG' } },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('DO-NOT-LOG');
  });

  it('redacts password in a request body', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: { body: { email: 'a@b.c', password: 'p4ssw0rd!' } },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('p4ssw0rd!');
    expect(out).toContain('a@b.c'); // emails are not secrets
  });

  it('redacts token in a request body', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: { body: { token: 'verify-token-xyz' } },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('verify-token-xyz');
  });

  it('redacts new_password and current_password', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: { body: { current_password: 'OLD-pw', new_password: 'NEW-pw' } },
        },
        'boom',
      ),
    );
    expect(out).not.toContain('OLD-pw');
    expect(out).not.toContain('NEW-pw');
  });

  it('does not redact non-sensitive fields', () => {
    const out = captureLog((l) =>
      l.error(
        {
          req: { body: { email: 'preserve@me.com' }, headers: { 'user-agent': 'curl/8' } },
        },
        'boom',
      ),
    );
    expect(out).toContain('preserve@me.com');
    expect(out).toContain('curl/8');
  });
});
