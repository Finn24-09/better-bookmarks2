import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { generateToken, hashToken, TTL } from '../tokens.js';
import { sendMail } from '../mailer.js';
import { deleteConfirmationTemplate } from '../templates/deleteConfirmation.js';
import { verifyJwt } from '../jwt.js';

export const requestDeleteRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/request-delete', async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const userResult = await pool.query<{ email: string }>(
        'SELECT email FROM auth.users WHERE id = $1',
        [userId],
      );
      if (!userResult.rowCount) {
        return reply.status(404).send({ error: 'Not found' });
      }
      const { email } = userResult.rows[0];

      const raw = generateToken();
      const hash = hashToken(raw);
      await pool.query(
        'SELECT auth.upsert_email_token($1, $2, $3, $4, $5)',
        [userId, hash, 'delete_confirmation', TTL.DELETE_CONFIRMATION, req.ip || null],
      );
      await pool.query(
        'INSERT INTO auth.email_send_log (user_id, token_type) VALUES ($1, $2)',
        [userId, 'delete_confirmation'],
      );
      const tmpl = deleteConfirmationTemplate(raw);
      await sendMail({ to: email, ...tmpl });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== '23505') {
        req.log.error({ err }, 'requestDelete: error');
        return reply.status(500).send({ error: 'Internal error' });
      }
    }

    return reply.status(200).send({ ok: true });
  });
};
