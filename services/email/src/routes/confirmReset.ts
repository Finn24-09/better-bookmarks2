import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { hashToken } from '../tokenUtils.js';
import { config } from '../config.js';
import { rateLimitFor } from '../rateLimit.js';

// S-7: Hashing happens inside auth.reset_password_destroy_data via
// crypt(p_new_pw, gen_salt('bf', 13)) so all account hashes share the
// same cost factor as sign_up and change_password. The Node service
// never sees a bcrypt hash; bcryptjs has been removed as a dependency.
const bodySchema = z.object({
  new_password: z.string().min(12).max(128),
});

export const confirmResetRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/confirm-reset', rateLimitFor('/confirm-reset'), async (req, reply) => {
    const cookieToken = req.cookies?.['reset_token'];
    if (!cookieToken || cookieToken.length > 256) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request' });
    }

    const tokenHash = hashToken(cookieToken);
    const newPassword = parsed.data.new_password;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Atomically redeem token — user_id comes only from this result, never from user input (C-3)
      const redeemResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM auth.redeem_email_token($1, 'password_reset')`,
        [tokenHash],
      );
      if (!redeemResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const userId = redeemResult.rows[0].user_id;
      // S-7: pass plaintext to the SQL function — it hashes with gen_salt('bf', 13).
      await client.query('SELECT auth.reset_password_destroy_data($1, $2)', [userId, newPassword]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      req.log.error({ err }, 'confirmReset: transaction failed');
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    reply.clearCookie('reset_token', {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/email/confirm-reset',
    });

    return reply.status(200).send({ ok: true });
  });
};
