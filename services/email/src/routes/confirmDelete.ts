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

    // M-2: Three-step flow — preflight, then redeem, then verify password.
    //
    //   1. Preflight (read-only): SELECT the token row and check that its
    //      user_id matches the JWT sub. If the token belongs to another
    //      user, return the generic error WITHOUT calling redeem — calling
    //      redeem would mark the legitimate owner's token used_at and
    //      lock them out (cross-user token consumption).
    //   2. Redeem (UPDATE used_at): only after the preflight passes.
    //      Atomic with the rest of the transaction.
    //   3. Password verification: a wrong password ROLLBACKs both the
    //      redeem and the audit log, so the legitimate user can retry
    //      with the same token (M-1).
    //
    // Error message: every failure path returns the SAME generic string
    // ("Invalid credentials"). Distinguishable strings would let a JWT-
    // holding attacker tell apart "I have a valid JWT but no matching
    // token" (token belongs to nobody / wrong user) from "I have a valid
    // JWT and a matching token but the password is wrong" — confirming
    // that the JWT user is the rightful owner of the leaked token.
    //
    // Brute-force is bounded by the route-level rate limit (5/min) AND
    // the 15-minute TTL on delete tokens.
    const GENERIC_ERROR = { error: 'Invalid credentials' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step 1: preflight — does this token exist, is it active, does it
      // belong to the JWT user? Read-only; no state mutation.
      const preflight = await client.query<{ user_id: string }>(
        `SELECT user_id FROM auth.email_tokens
         WHERE token_hash = $1
           AND token_type = 'delete_confirmation'
           AND used_at IS NULL
           AND expires_at > NOW()`,
        [tokenHash],
      );
      if (!preflight.rowCount || preflight.rows[0].user_id !== userId) {
        await client.query('ROLLBACK');
        return reply.status(400).send(GENERIC_ERROR);
      }

      // Step 2: redeem (consume) the token. Safe to call now — we know
      // it belongs to the JWT user.
      const redeemResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM auth.redeem_email_token($1, 'delete_confirmation')`,
        [tokenHash],
      );
      if (!redeemResult.rowCount || redeemResult.rows[0].user_id !== userId) {
        // Concurrent redemption raced us. Treat as not-found.
        await client.query('ROLLBACK');
        return reply.status(400).send(GENERIC_ERROR);
      }

      // Step 3: password verification + cascading delete inside the same
      // transaction. email_svc has no direct DELETE on auth.users — the
      // SECURITY DEFINER function handles bcrypt verification and the
      // delete atomically. A wrong password ROLLBACKs everything,
      // including the redeem above (M-1).
      //
      // S-1: Guard against the SECURITY DEFINER function ever returning
      // zero rows or an unexpected shape. Reading rows[0].x without a
      // null-check would throw a TypeError on the next line and surface
      // as 500 — a fingerprintable difference from the generic 400 we
      // return for every other failure path. ROLLBACK and use the same
      // generic 400 the wrong-password / bad-token branches use.
      const deleteResult = await client.query<{ delete_account_with_password: boolean }>(
        'SELECT auth.delete_account_with_password($1::uuid, $2)',
        [userId, password],
      );
      if (!deleteResult.rowCount || !deleteResult.rows[0]?.delete_account_with_password) {
        await client.query('ROLLBACK');
        return reply.status(400).send(GENERIC_ERROR);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // S-2: Sanitise the logged error. The catch block can be reached by
      // a query that carried a plaintext password as a parameter
      // (auth.delete_account_with_password). node-postgres MAY attach
      // err.parameters on some failure paths, and Fastify's default pino
      // serializer would render anything attached to err. Strip to known
      // safe fields only.
      req.log.error(
        { err: { message: (err as Error).message, code: (err as { code?: string }).code } },
        'confirmDelete: transaction failed',
      );
      return reply.status(500).send({ error: 'Internal error' });
    } finally {
      client.release();
    }

    // Fire-and-forget audit log — failure must not block the success response.
    // M-4: req.ip is derived from trustProxy:1 in src/index.ts (one trusted
    // hop = Nginx). Reading x-real-ip directly would honour an attacker-
    // controlled header from outside the trust boundary.
    await pool.query(
      `INSERT INTO auth.security_audit_log (user_id, event_type, token_type, ip_address)
       VALUES ($1, 'account_deleted', 'delete_confirmation', $2)`,
      [userId, req.ip || null],
    ).catch((err) => req.log.warn({ err }, 'confirmDelete: audit log failed'));

    return reply.status(200).send({ ok: true });
  });
};
