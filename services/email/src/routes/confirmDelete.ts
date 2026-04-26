import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { hashToken } from '../tokens.js';
import { verifyJwt } from '../jwt.js';

const bodySchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(128),
});

export const confirmDeleteRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/confirm-delete', async (req, reply) => {
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

    // Phase 1: Redeem token atomically and commit immediately.
    // Permanently consuming the token on first valid redemption prevents brute-forcing
    // the password against a valid token across the 15-minute TTL window.
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
      await client.query('COMMIT'); // token permanently consumed
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      req.log.error({ err }, 'confirmDelete: redeem failed');
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    // Phase 2: Verify password + delete account.
    // email_svc has no direct DELETE on auth.users — the SECURITY DEFINER function
    // handles both bcrypt verification and cascading deletion atomically.
    // Token is already consumed; wrong password here requires requesting a new email.
    try {
      const { rows } = await pool.query<{ delete_account_with_password: boolean }>(
        'SELECT auth.delete_account_with_password($1::uuid, $2)',
        [userId, password],
      );
      if (!rows[0].delete_account_with_password) {
        return reply.status(400).send({ error: 'Invalid password' });
      }
    } catch (err) {
      req.log.error({ err }, 'confirmDelete: delete failed');
      return reply.status(500).send({ error: 'Internal error' });
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
