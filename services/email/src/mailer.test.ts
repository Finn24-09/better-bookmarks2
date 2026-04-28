import { describe, it, expect, vi, beforeEach } from 'vitest';

// Typed as accepting one opaque options arg so mock.calls[0][0] is well-typed.
const mockCreateTransport = vi.hoisted(
  () => vi.fn((_opts: Record<string, unknown>) => ({ sendMail: vi.fn() })),
);

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

describe('mailer transport configuration (H-3: STARTTLS downgrade prevention)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateTransport.mockClear();
    mockCreateTransport.mockReturnValue({ sendMail: vi.fn() });
  });

  it('H-3: when SMTP_SECURE=false, transport must require STARTTLS (requireTLS:true)', async () => {
    vi.doMock('./config.js', () => ({
      config: {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        SMTP_FROM: 'from@example.com',
        SMTP_REQUIRE_TLS: true,
        NODE_ENV: 'production',
      },
    }));

    await import('./mailer.js');

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    const opts = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.secure).toBe(false);
    // H-3: without requireTLS:true, an attacker stripping the STARTTLS
    // capability response causes plaintext credential and token leakage.
    expect(opts.requireTLS).toBe(true);
  });

  it('H-3: TLS options enforce TLS 1.2+ and certificate validation', async () => {
    vi.doMock('./config.js', () => ({
      config: {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        SMTP_FROM: 'from@example.com',
        SMTP_REQUIRE_TLS: true,
        NODE_ENV: 'production',
      },
    }));

    await import('./mailer.js');

    const opts = mockCreateTransport.mock.calls[0][0] as { tls?: Record<string, unknown> };
    expect(opts.tls).toBeDefined();
    expect(opts.tls!.minVersion).toBe('TLSv1.2');
    expect(opts.tls!.rejectUnauthorized).toBe(true);
  });

  it('H-3: when SMTP_SECURE=true (port 465), implicit TLS still works', async () => {
    vi.doMock('./config.js', () => ({
      config: {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 465,
        SMTP_SECURE: true,
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        SMTP_FROM: 'from@example.com',
        SMTP_REQUIRE_TLS: true,
        NODE_ENV: 'production',
      },
    }));

    await import('./mailer.js');

    const opts = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.secure).toBe(true);
    // requireTLS is harmless when secure:true (already TLS); we still pass
    // it for consistency. The TLS hardening options must still be present.
    expect((opts.tls as Record<string, unknown>).minVersion).toBe('TLSv1.2');
    expect((opts.tls as Record<string, unknown>).rejectUnauthorized).toBe(true);
  });

  // Nit: dev SMTP servers (MailHog, Mailpit) on port 1025 don't speak
  // STARTTLS, so requireTLS:true breaks every local dev session. Add an
  // opt-out gated to non-production.
  it('Nit: when SMTP_REQUIRE_TLS=false in development, requireTLS is omitted', async () => {
    vi.doMock('./config.js', () => ({
      config: {
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_SECURE: false,
        SMTP_USER: 'dev',
        SMTP_PASS: 'dev',
        SMTP_FROM: 'dev@example.com',
        SMTP_REQUIRE_TLS: false,
        NODE_ENV: 'development',
      },
    }));

    await import('./mailer.js');

    const opts = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.secure).toBe(false);
    // The whole point of the flag: STARTTLS must NOT be enforced in this mode.
    expect(opts.requireTLS).toBeFalsy();
  });

  it('Nit: when SMTP_REQUIRE_TLS=true (default), requireTLS stays enabled', async () => {
    vi.doMock('./config.js', () => ({
      config: {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
        SMTP_FROM: 'from@example.com',
        SMTP_REQUIRE_TLS: true,
        NODE_ENV: 'production',
      },
    }));

    await import('./mailer.js');

    const opts = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.requireTLS).toBe(true);
  });
});
