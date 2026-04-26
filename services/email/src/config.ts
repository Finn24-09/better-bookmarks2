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
  SMTP_HOST:                 z.string().min(1),
  SMTP_PORT:                 z.coerce.number().int().positive().default(587),
  SMTP_SECURE:               z.string().transform(v => v === 'true').default('false'),
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

export const config = {
  ...parsed.data,
  APP_BASE_URL: validateBaseUrl(parsed.data.APP_BASE_URL),
};
