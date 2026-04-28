import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { generateToken, hashToken, TTL } from '../tokenUtils.js';
import { sendMail } from '../mailer.js';
import { verifyEmailTemplate } from '../templates/verifyEmail.js';
import { verifyJwt } from '../jwt.js';
import { rateLimitFor } from '../rateLimit.js';

// Per-user resend cooldown. Kept in sync with the EmailVerificationBanner
// constant (COOLDOWN_MS) so the client can never request a resend before the
// server allows it. This is the per-user UX guard.
const COOLDOWN_SECONDS = 60;

// Per-user absolute ceiling. Without this, the 60-second cooldown allows up
// to 1,440 verification mails per day per JWT — a mail-bombing primitive
// against the legitimate user's inbox (and our SES bounce/complaint rate).
// Compute against the same email_send_log; cleanup runs at 24h so the window
// is naturally bounded. Apply only to email_verification — password_reset
// gets enumeration-safe rate limiting via its own route.
const DAILY_CEILING = 10;

export const resendVerificationRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/resend-verification', rateLimitFor('/resend-verification'), async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Cooldown check + token upsert + email_send_log INSERT must be atomic
    // to prevent two concurrent requests from both passing the check before
    // either inserts the log row (S-4). All DB writes for this request are
    // performed on the same client inside a single transaction.
    //
    // Note: sendMail is called only after a successful COMMIT — a failed send
    // does not roll back the cooldown, but two concurrent senders cannot both
    // bypass the cooldown.
    let toEmail: string | null = null;
    let rawToken: string | null = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Serialise concurrent resend attempts for the same user. We can't use
      // SELECT ... FOR UPDATE on auth.users because email_svc has only
      // column-level SELECT (no UPDATE) on that table — Postgres would reject
      // the row lock with `42501 permission denied for table users`. Advisory
      // locks need no table grants and are released automatically on
      // COMMIT/ROLLBACK. The 'resend_verification:' prefix avoids hash-key
      // collisions with any other advisory locks the service may add later.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('resend_verification:' || $1::text))`,
        [userId],
      );

      const cooldownResult = await client.query(
        `SELECT 1 FROM auth.email_send_log
         WHERE user_id = $1
           AND token_type = 'email_verification'
           AND sent_at > NOW() - ($2 * INTERVAL '1 second')
         LIMIT 1`,
        [userId, COOLDOWN_SECONDS],
      );
      if (cooldownResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(429).send({ error: 'Too many requests' });
      }

      const ceilingResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM auth.email_send_log
         WHERE user_id = $1
           AND token_type = 'email_verification'
           AND sent_at > NOW() - INTERVAL '24 hours'`,
        [userId],
      );
      if (Number(ceilingResult.rows[0]?.count ?? '0') >= DAILY_CEILING) {
        await client.query('ROLLBACK');
        return reply.status(429).send({ error: 'Too many requests' });
      }

      const userResult = await client.query<{ email: string; email_verified: boolean }>(
        'SELECT email, email_verified FROM auth.users WHERE id = $1',
        [userId],
      );
      if (!userResult.rowCount) {
        await client.query('ROLLBACK');
        return reply.status(404).send({ error: 'Not found' });
      }
      const { email, email_verified } = userResult.rows[0];
      if (email_verified) {
        await client.query('ROLLBACK');
        return reply.status(200).send({ ok: true });
      }

      const raw = generateToken();
      const hash = hashToken(raw);
      await client.query(
        'SELECT auth.upsert_email_token($1, $2, $3, $4, $5)',
        [userId, hash, 'email_verification', TTL.EMAIL_VERIFICATION, req.ip || null],
      );
      await client.query(
        'INSERT INTO auth.email_send_log (user_id, token_type) VALUES ($1, $2)',
        [userId, 'email_verification'],
      );
      await client.query('COMMIT');

      toEmail  = email;
      rawToken = raw;
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      // 23505 = concurrent insert race on the unique active-token index.
      // Treat as cooldown hit — caller should not retry.
      if ((err as { code?: string }).code === '23505') {
        return reply.status(200).send({ ok: true });
      }
      req.log.error({ err }, 'resendVerification: error');
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    // Send email outside the transaction. A failure here returns 500 to the
    // caller; the cooldown remains in place because the COMMIT has already
    // happened — preferable to leaking via concurrent re-sends.
    if (toEmail && rawToken) {
      try {
        const tmpl = verifyEmailTemplate(rawToken);
        await sendMail({ to: toEmail, ...tmpl });
      } catch (err) {
        req.log.error({ err }, 'resendVerification: sendMail failed');
        return reply.status(500).send({ error: 'Internal error' });
      }
    }

    return reply.status(200).send({ ok: true });
  });
};
