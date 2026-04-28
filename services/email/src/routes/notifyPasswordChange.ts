import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { sendMail } from '../mailer.js';
import { passwordChangedTemplate } from '../templates/passwordChanged.js';
import { verifyJwt } from '../jwt.js';
import { rateLimitFor } from '../rateLimit.js';

// TODO(security M-6): /notify-password-change currently trusts the JWT alone
// to assert that a password rotation actually happened. A stolen JWT is a
// phishing-pretext primitive — an attacker can replay the call to inject a
// "your password was changed" email into the legitimate user's inbox.
// The proper fix is a coordinated change with the auth service: have
// PostgREST mint a short-lived, single-use signed claim on actual password
// rotation that this route verifies before sending. Out of scope for this
// PR — the rate limiter below at least bounds the abuse rate to 10 / 5min.

const COOLDOWN_MINUTES = 5;

export const notifyPasswordChangeRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/notify-password-change', rateLimitFor('/notify-password-change'), async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // S-4: serialise concurrent attempts and enforce a per-user cooldown so
    // a stolen JWT cannot weaponise this route as an inbox-spam primitive
    // against the same signal it is meant to provide. Cooldown bookkeeping
    // is committed to auth.email_send_log only after a successful send
    // (S-5: sendMail runs before COMMIT — a failed send rolls back the row).
    //
    // Silent dedupe on cooldown hit: returning 429 here would leak to a
    // stolen-JWT attacker that throttling is in effect. 200 ok:true is the
    // correct UX for a notification-only endpoint.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('notify_password_change:' || $1::text))`,
        [userId],
      );

      const cooldownResult = await client.query(
        `SELECT 1 FROM auth.email_send_log
         WHERE user_id = $1
           AND token_type = 'password_change_notification'
           AND sent_at > NOW() - ($2 * INTERVAL '1 minute')
         LIMIT 1`,
        [userId, COOLDOWN_MINUTES],
      );
      if (cooldownResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(200).send({ ok: true });
      }

      const userResult = await client.query<{ email: string }>(
        'SELECT email FROM auth.users WHERE id = $1',
        [userId],
      );
      if (!userResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(200).send({ ok: true });
      }
      const { email } = userResult.rows[0];

      await client.query(
        'INSERT INTO auth.email_send_log (user_id, token_type) VALUES ($1, $2)',
        [userId, 'password_change_notification'],
      );

      // Send BEFORE COMMIT so a send failure rolls back the cooldown row.
      const tmpl = passwordChangedTemplate({ changedAt: new Date() });
      await sendMail({ to: email, ...tmpl });

      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      if ((err as { code?: string }).code === '23505') {
        return reply.status(200).send({ ok: true });
      }
      req.log.error({ err }, 'notifyPasswordChange: error');
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    return reply.status(200).send({ ok: true });
  });
};
