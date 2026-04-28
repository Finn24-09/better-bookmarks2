import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { hashToken } from '../tokenUtils.js';
import { verifyJwt } from '../jwt.js';
import { rateLimitFor } from '../rateLimit.js';

const bodySchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(128),
});

export const confirmDeleteRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/confirm-delete', rateLimitFor('/confirm-delete'), async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });

    const { token, password } = parsed.data;
    const tokenHash = hashToken(token);

    // M-1: Redeem token AND verify password in a single transaction.
    // If the password is wrong we ROLLBACK so the token row stays unused —
    // an attacker who intercepts a valid token cannot lock the legitimate
    // user out by consuming it with a wrong password.
    // Brute-force is still bounded by the Nginx rate limit and the 15-minute TTL.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const redeemResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM auth.redeem_email_token($1, 'delete_confirmation')`,
        [tokenHash],
      );
      if (!redeemResult.rowCount || redeemResult.rows[0].user_id !== userId) {
        await client.query('ROLLBACK');
        return reply.status(400).send({ error: 'Invalid or expired token' });
      }

      // Password verification inside the same transaction.
      // email_svc has no direct DELETE on auth.users — the SECURITY DEFINER
      // function handles bcrypt verification and cascading deletion atomically.
      const deleteResult = await client.query<{ delete_account_with_password: boolean }>(
        'SELECT auth.delete_account_with_password($1::uuid, $2)',
        [userId, password],
      );
      if (!deleteResult.rows[0].delete_account_with_password) {
        await client.query('ROLLBACK'); // token NOT consumed on wrong password
        return reply.status(400).send({ error: 'Invalid password' });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      req.log.error({ err }, 'confirmDelete: transaction failed');
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    // Fire-and-forget audit log — failure must not block the success response.
    await pool.query(
      `INSERT INTO auth.security_audit_log (user_id, event_type, token_type, ip_address)
       VALUES ($1, 'account_deleted', 'delete_confirmation', $2)`,
      [userId, (req.headers['x-real-ip'] as string) ?? null],
    ).catch((err) => req.log.warn({ err }, 'confirmDelete: audit log failed'));

    return reply.status(200).send({ ok: true });
  });
};
