import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { hashToken } from '../tokenUtils.js';
import { config } from '../config.js';

export const verifyEmailRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/verify-email', async (req, reply) => {
    const token = (req.query as Record<string, string>)['token'] ?? '';
    // Hash fragment with embedded query string — parsed by App.tsx hash handler. The `?` is part of the fragment, not a real query string.
    if (!token || token.length > 256) {
      return reply.redirect(`${config.APP_BASE_URL}/#email-verified?error=invalid`);
    }

    const tokenHash = hashToken(token);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const redeemResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM auth.redeem_email_token($1, 'email_verification')`,
        [tokenHash],
      );
      if (!redeemResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.redirect(`${config.APP_BASE_URL}/#email-verified?error=expired`);
      }
      const userId = redeemResult.rows[0].user_id;
      await client.query('SELECT auth.mark_email_verified($1)', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error({ err }, 'verifyEmail: transaction failed');
      return reply.redirect(`${config.APP_BASE_URL}/#email-verified?error=invalid`);
    } finally {
      client.release();
    }

    return reply.redirect(`${config.APP_BASE_URL}/#email-verified?success=true`);
  });
};
