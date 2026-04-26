import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { hashToken, TTL } from '../tokenUtils.js';
import { config } from '../config.js';

export const resetPasswordRoute: FastifyPluginAsync = async (fastify) => {
  // GET /reset-password?token=xxx
  // Validates token (does NOT redeem it), sets an HttpOnly session cookie,
  // then redirects to /#reset-password (no token in redirect URL — H-1, H-3).
  fastify.get('/reset-password', async (req, reply) => {
    const token = (req.query as Record<string, string>)['token'] ?? '';
    // Hash fragment with embedded query string — parsed by App.tsx hash handler. The `?` is part of the fragment, not a real query string.
    if (!token || token.length > 256) {
      return reply.redirect(`${config.APP_BASE_URL}/#reset-password?error=invalid`);
    }

    const hash = hashToken(token);
    try {
      const result = await pool.query(
        `SELECT id FROM auth.email_tokens
         WHERE token_hash = $1
           AND token_type = 'password_reset'
           AND used_at IS NULL
           AND expires_at > NOW()`,
        [hash],
      );
      if (!result.rowCount) {
        return reply.redirect(`${config.APP_BASE_URL}/#reset-password?error=expired`);
      }
    } catch (err) {
      req.log.error({ err }, 'resetPassword: db error');
      return reply.redirect(`${config.APP_BASE_URL}/#reset-password?error=invalid`);
    }

    // Exchange URL token for an HttpOnly session cookie (closes H-1 TOCTOU, H-3 log exposure)
    reply.setCookie('reset_token', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/email/confirm-reset',
      maxAge: TTL.RESET_COOKIE_SECS,
    });

    return reply.redirect(`${config.APP_BASE_URL}/#reset-password`);
  });
};
