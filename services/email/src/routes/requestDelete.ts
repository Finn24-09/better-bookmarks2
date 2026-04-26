import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { generateToken, hashToken, TTL } from '../tokenUtils.js';
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

    // S-6: token upsert + email_send_log INSERT + sendMail must be atomic
    // with respect to the cooldown window. Performing the work on a single
    // client inside one transaction means a failed sendMail rolls back the
    // log INSERT, so the user is not locked out of retrying for 15 minutes
    // when the SMTP provider is transiently unavailable.
    //
    // Concurrency: the unique-active-token index on email_tokens already
    // serialises two simultaneous requests for the same user/type — the
    // second hits 23505 and is treated as a no-op (200).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query<{ email: string }>(
        'SELECT email FROM auth.users WHERE id = $1',
        [userId],
      );
      if (!userResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Not found' });
      }
      const { email } = userResult.rows[0];

      const raw  = generateToken();
      const hash = hashToken(raw);
      await client.query(
        'SELECT auth.upsert_email_token($1, $2, $3, $4, $5)',
        [userId, hash, 'delete_confirmation', TTL.DELETE_CONFIRMATION, req.ip || null],
      );
      await client.query(
        'INSERT INTO auth.email_send_log (user_id, token_type) VALUES ($1, $2)',
        [userId, 'delete_confirmation'],
      );

      // Send BEFORE COMMIT so a send failure rolls back the log row.
      const tmpl = deleteConfirmationTemplate(raw);
      await sendMail({ to: email, ...tmpl });

      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      if ((err as { code?: string }).code === '23505') {
        return reply.status(200).send({ ok: true });
      }
      req.log.error({ err }, 'requestDelete: error');
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    return reply.status(200).send({ ok: true });
  });
};
