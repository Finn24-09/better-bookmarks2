import { z } from 'zod';

function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`APP_BASE_URL is not a valid URL: ${raw}`);
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error(`APP_BASE_URL must use http or https, got: ${url.protocol}`);
  }
  return url.origin + url.pathname.replace(/\/$/, '');
}

const envSchema = z.object({
  EMAIL_DATABASE_URL:        z.string().min(1),
  JWT_SECRET:                z.string().min(32),
  // H-4: Pin JWT audience so tokens issued by PostgREST (or any other
  // service sharing the JWT secret) cannot be replayed against this
  // service. The token-issuance side (api._sign_jwt in
  // docker/db/init/11_jwt_audience.sql) sets `aud=email-svc` on every
  // minted JWT, and verification here is unconditionally strict — any
  // token without the correct aud is rejected.
  JWT_AUDIENCE:              z.string().min(1).default('email-svc'),
  // Optional issuer pin. Only enforced when set, since the auth issuer
  // name may not yet be stable across environments.
  JWT_ISSUER:                z.string().min(1).optional(),
  SMTP_HOST:                 z.string().min(1),
  SMTP_PORT:                 z.coerce.number().int().positive().default(587),
  SMTP_SECURE:               z.string().transform(v => v === 'true').default('false'),
  // Defaults to true; set SMTP_REQUIRE_TLS=false ONLY for local dev pointed
  // at MailHog / Mailpit (which don't speak STARTTLS on port 1025).
  // Disabling in production is rejected at startup — see post-parse check.
  SMTP_REQUIRE_TLS:          z.string().transform(v => v !== 'false').default('true'),
  SMTP_USER:                 z.string().min(1),
  SMTP_PASS:                 z.string().min(1),
  SMTP_FROM:                 z.string().min(1),
  APP_BASE_URL:              z.string().min(1),
  AWS_SES_REGION:            z.string().optional(),
  AWS_SES_CONFIGURATION_SET: z.string().optional(),
  AWS_SES_FROM_ARN:          z.string().optional(),
  COOKIE_SECRET:             z.string().min(32),
  PORT:                      z.coerce.number().int().positive().default(5001),
  NODE_ENV:                  z.enum(['development', 'production', 'test']).default('production'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Refuse to start with TLS enforcement disabled in production. The dev
// escape hatch must never reach a real deployment — without requireTLS
// an on-path attacker can strip STARTTLS and exfiltrate SMTP credentials
// and outgoing tokens in cleartext.
if (parsed.data.NODE_ENV === 'production' && parsed.data.SMTP_REQUIRE_TLS === false) {
  console.error('[config] SMTP_REQUIRE_TLS=false is forbidden in production');
  process.exit(1);
}

export const config = {
  ...parsed.data,
  APP_BASE_URL: validateBaseUrl(parsed.data.APP_BASE_URL),
};
