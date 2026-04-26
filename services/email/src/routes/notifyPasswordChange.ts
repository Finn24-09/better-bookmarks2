import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { sendMail } from '../mailer.js';
import { passwordChangedTemplate } from '../templates/passwordChanged.js';
import { verifyJwt } from '../jwt.js';

export const notifyPasswordChangeRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/notify-password-change', async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Fire-and-forget: always return 200, never block on email delivery
    pool.query<{ email: string }>('SELECT email FROM auth.users WHERE id = $1', [userId])
      .then(result => {
        if (!result.rowCount) return;
        const tmpl = passwordChangedTemplate();
        return sendMail({ to: result.rows[0].email, ...tmpl });
      })
      .catch(err => req.log.error({ err }, 'notifyPasswordChange: error'));

    return reply.status(200).send({ ok: true });
  });
};
