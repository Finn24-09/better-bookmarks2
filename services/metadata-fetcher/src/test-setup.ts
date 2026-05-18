// Vitest setup file (referenced from vitest.config.ts).
//
// Provides a minimal, non-secret env so modules that parse process.env at
// import time (config.ts → jwt.ts → rateLimit.ts) succeed. Individual tests
// that exercise env validation pass their own synthetic env objects to
// parseConfig() directly.

const TEST_DEFAULTS: Record<string, string> = {
  JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
  JWT_AUDIENCE: 'metadata-svc',
  PORT: '5002',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
};

for (const [key, value] of Object.entries(TEST_DEFAULTS)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
