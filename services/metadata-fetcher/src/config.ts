import { z } from 'zod';

const envSchema = z.object({
  JWT_SECRET:    z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Pinned audience for tokens this service will accept. The token-issuance
  // side (api._sign_jwt in docker/db/init/11_jwt_audience.sql) mints
  // aud=["email-svc","metadata-svc"] so the same token authenticates both
  // sibling services; jose 6 set-membership semantics make the string check
  // here pass for an array claim containing this value.
  JWT_AUDIENCE:  z.string().min(1).default('metadata-svc'),
  // Optional issuer pin. Only enforced when set.
  JWT_ISSUER:    z.string().min(1).optional(),
  PORT:          z.coerce.number().int().positive().default(5002),
  NODE_ENV:      z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL:     z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Backstop response body cap. The streaming early-stop on </head> means
  // typical pages resolve well under this; the cap fires only on
  // pathological / malformed pages without </head>. Bounds chosen to keep
  // operator overrides safe: 256 KiB floor (smaller is unsafe even for
  // simple pages); 8 MiB ceiling (32 concurrent × 8 MiB = 256 MiB; would
  // require a matching mem_limit bump on the compose service).
  MAX_BODY_BYTES: z.coerce.number().int()
    .min(256 * 1024)
    .max(8 * 1024 * 1024)
    .default(2 * 1024 * 1024),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Parse and validate an env object. Exposed so tests can drive synthetic
 * envs without re-importing the module; production callers use the default
 * `config` constant below which parses `process.env` at module load.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`[config] Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export const config: Config = parseConfig();
