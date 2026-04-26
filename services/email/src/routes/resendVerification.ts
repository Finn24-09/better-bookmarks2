import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { generateToken, hashToken, TTL } from '../tokens.js';
import { sendMail } from '../mailer.js';
import { verifyEmailTemplate } from '../templates/verifyEmail.js';
import { verifyJwt } from '../jwt.js';

const COOLDOWN_MINUTES = 10;

export const resendVerificationRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/resend-verification', async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Per-user cooldown check (H-6)
    try {
      const cooldownResult = await pool.query(
        `SELECT 1 FROM auth.email_send_log
         WHERE user_id = $1
           AND token_type = 'email_verification'
           AND sent_at > NOW() - INTERVAL '${COOLDOWN_MINUTES} minutes'
         LIMIT 1`,
        [userId],
      );
      if (cooldownResult.rowCount) {
        return reply.status(429).send({ error: 'Too many requests' });
      }

      const userResult = await pool.query<{ email: string; email_verified: boolean }>(
        'SELECT email, email_verified FROM auth.users WHERE id = $1',
        [userId],
      );
      if (!userResult.rowCount) {
        return reply.status(404).send({ error: 'Not found' });
      }
      const { email, email_verified } = userResult.rows[0];
      if (email_verified) {
        return reply.status(200).send({ ok: true });
      }

      const raw = generateToken();
      const hash = hashToken(raw);
      await pool.query(
        'SELECT auth.upsert_email_token($1, $2, $3, $4, $5)',
        [userId, hash, 'email_verification', TTL.EMAIL_VERIFICATION, req.ip || null],
      );
      await pool.query(
        'INSERT INTO auth.email_send_log (user_id, token_type) VALUES ($1, $2)',
        [userId, 'email_verification'],
      );
      const tmpl = verifyEmailTemplate(raw);
      await sendMail({ to: email, ...tmpl });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== '23505') {
        req.log.error({ err }, 'resendVerification: error');
        return reply.status(500).send({ error: 'Internal error' });
      }
    }

    return reply.status(200).send({ ok: true });
  });
};
