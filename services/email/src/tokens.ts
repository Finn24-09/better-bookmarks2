import crypto from 'node:crypto';

export const TTL = {
  EMAIL_VERIFICATION:  86_400,  // 24 hours
  PASSWORD_RESET:       3_600,  // 1 hour
  DELETE_CONFIRMATION:    900,  // 15 minutes
  RESET_COOKIE_SECS:      300,  // 5 minutes (HttpOnly session cookie)
} as const;

/** Generate a 32-byte URL-safe base64 token (256 bits entropy). */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest — this is the only form stored in the DB. */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
