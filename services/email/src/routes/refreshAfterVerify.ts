import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { verifyJwt } from '../jwt.js';
import { rateLimitFor } from '../rateLimit.js';

/**
 * POST /refresh-after-verify
 *
 * Mints a fresh JWT carrying `email_verified=true` for the bearer-auth'd
 * user, but ONLY if the DB-side preconditions in
 * `auth.mint_post_verify_jwt` hold (email_verified=true AND
 * email_verified_at within the last 5 minutes — see
 * docker/db/init/12_post_verify_jwt.sql for the full rationale).
 *
 * Why this route exists: the metadata-fetcher service gates POST /title on
 * the JWT's `email_verified` claim because it cannot consult the DB
 * (deliberate network isolation, see docker-compose.yml metadata_net). The
 * claim is set at sign-in but goes stale when a user verifies AFTER
 * sign-in. The frontend calls this route immediately after the
 * verify-email link redirects back to the SPA, swaps the in-memory JWT,
 * and the gate accepts the user's next /title call.
 *
 * Auth: bearer required, BUT the verifier intentionally does NOT inspect
 * the `email_verified` claim — stale claim=false is exactly the case we are
 * here to refresh. The DB function performs the authoritative check.
 *
 * Errors: any precondition failure in the DB function (unverified,
 * window expired, user not found) maps to a single 410 Gone with a generic
 * body. The frontend treats 410 as "fall back to next-sign-in refresh"
 * silently — verification itself already succeeded, so we never surface
 * an error toast to the user.
 */
export const refreshAfterVerifyRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/refresh-after-verify', rateLimitFor('/refresh-after-verify'), async (req, reply) => {
    let userId: string;
    try {
      ({ sub: userId } = await verifyJwt(req.headers.authorization));
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const result = await pool.query<{ token: string }>(
        'SELECT token FROM auth.mint_post_verify_jwt($1)',
        [userId],
      );
      if (!result.rowCount) {
        // Defence-in-depth: the function either RETURNS QUERY a row or
        // RAISES; an empty result would be a contract violation. Map to the
        // same 410 the precondition path uses.
        return reply.status(410).send({ error: 'Verification window expired' });
      }
      const { token } = result.rows[0];
      // The DB function's preconditions (email_verified IS TRUE +
      // 5-minute window) gate the mint, so a successful return implies the
      // user is verified. We do NOT echo email_verified in the response
      // because doing so would create a dead-weight field the frontend
      // must validate forever; the new JWT itself carries the claim and
      // is the authoritative signal.
      return reply.status(200).send({ token });
    } catch (err: unknown) {
      // 23514 = check_violation (raised by the DB function for unverified
      // user or stale verification window). P0002 = no_data_found (user
      // row missing — token still valid against a deleted user, e.g. mid
      // account-deletion). Both collapse to a single user-visible state
      // that the frontend can silently retry-via-next-sign-in.
      const code = (err as { code?: string }).code;
      if (code === '23514' || code === 'P0002') {
        return reply.status(410).send({ error: 'Verification window expired' });
      }
      req.log.error({ err, user_id: userId }, 'refreshAfterVerify: mint failed');
      return reply.status(500).send({ error: 'Internal error' });
    }
  });
};
