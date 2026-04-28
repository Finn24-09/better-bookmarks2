import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { generateToken, hashToken, TTL } from '../tokenUtils.js';
import { sendMail } from '../mailer.js';
import { resetPasswordTemplate } from '../templates/resetPassword.js';
import { rateLimitFor } from '../rateLimit.js';

const bodySchema = z.object({
  email: z.string().email().max(255).transform(v => v.replace(/[\x00-\x1f\x7f]/g, '')),
});

const RESPONSE_FLOOR_MS = 800;

export const requestResetRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/request-reset', rateLimitFor('/request-reset'), async (req, reply) => {
    const start = Date.now();

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      await enforceFloor(start);
      return reply.status(200).send({ ok: true });
    }
    const { email } = parsed.data;

    try {
      const userResult = await pool.query<{ id: string; email: string }>(
        'SELECT id, email FROM auth.users WHERE email = $1',
        [email],
      );

      if (userResult.rowCount && userResult.rowCount > 0) {
        const user = userResult.rows[0];
        const raw = generateToken();
        const hash = hashToken(raw);

        try {
          await pool.query(
            'SELECT auth.upsert_email_token($1, $2, $3, $4, $5)',
            [user.id, hash, 'password_reset', TTL.PASSWORD_RESET, req.ip || null],
          );
          // H-1: dispatch SMTP asynchronously (fire-and-forget). Awaiting
          // sendMail inside the request lifecycle leaks SMTP RTT into the
          // wall-clock response time, defeating the timing-floor and
          // creating a statistical timing oracle for email enumeration.
          // The token row is already committed; the email itself is best-
          // effort. Failures are logged but never surface to the caller.
          const tmpl = resetPasswordTemplate(raw);
          void sendMail({ to: user.email, ...tmpl }).catch((err: unknown) => {
            req.log.error({ err }, 'requestReset: send failed');
          });
        } catch (err: unknown) {
          // 23505 = concurrent insert race — silently ignore (M-1)
          if ((err as { code?: string }).code !== '23505') {
            req.log.error({ err }, 'requestReset: token insert failed');
          }
        }
      }
    } catch (err) {
      req.log.error({ err }, 'requestReset: db error');
    }

    await enforceFloor(start);
    return reply.status(200).send({ ok: true });
  });
};

async function enforceFloor(start: number): Promise<void> {
  const elapsed = Date.now() - start;
  if (elapsed < RESPONSE_FLOOR_MS) {
    await new Promise(r => setTimeout(r, RESPONSE_FLOOR_MS - elapsed));
  }
}
