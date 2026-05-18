import { jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import { config } from './config.js';
import { jwtEmailVerifiedTotal } from './metrics.js';

const secretKey = createSecretKey(Buffer.from(config.JWT_SECRET, 'utf-8'));

// Audience and issuer pinning. The JWT secret is shared with PostgREST and
// the email service. Without an `aud` check, any token signed for an
// unrelated consumer could be replayed against this service.
//
// The token-issuance side (api._sign_jwt in docker/db/init/11_jwt_audience.sql)
// mints aud=["email-svc","metadata-svc"]; jose 6 audience verification
// treats a string requested audience as set-membership against an array
// claim, so this verifier accepts the array as long as it contains
// `metadata-svc`.
//
// email_verified gating: the metadata-fetcher sits on a dedicated
// `metadata_net` Docker network with no L3 path to the database (deliberate
// SSRF blast-radius cap). Because of that, it cannot consult
// auth.users.email_verified directly — the JWT claim is the only signal
// available. The verifier requires the claim to be present (jose's
// requiredClaims fails closed if it is absent) and to be strictly the
// JS boolean `true`. Any other shape (false, "true" string, 0, 1, null,
// object, array) rejects with EmailNotVerifiedError so the route can return
// 403, distinct from the 401 unauthorized path. See
// docker/db/init/12_post_verify_jwt.sql for the post-verify refresh path
// that closes the staleness gap on false → true transitions.

export class EmailNotVerifiedError extends Error {
  kind = 'email-not-verified' as const;
  statusCode = 403;
  constructor() {
    super('Email not verified');
  }
}

export async function verifyJwt(
  authHeader: string | undefined,
): Promise<{ sub: string; email_verified: boolean }> {
  if (!authHeader?.startsWith('Bearer ')) throw unauth();
  const token = authHeader.slice(7);
  let payload: Record<string, unknown>;
  try {
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: ['HS256'],
      // email_verified is required: a token without it predates the
      // post-verify mint or was minted by a misconfigured signer. Fail at
      // jose level so the route returns 401, not 403 — these tokens are not
      // "verified but unverified", they are "not from this trust root".
      requiredClaims: ['sub', 'role', 'exp', 'email_verified'],
      audience: config.JWT_AUDIENCE,
    };
    if (config.JWT_ISSUER) {
      verifyOptions.issuer = config.JWT_ISSUER;
    }
    ({ payload } = await jwtVerify(token, secretKey, verifyOptions));
  } catch {
    throw unauth();
  }
  if (payload['role'] !== 'app_user') throw unauth();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(payload.sub))) throw unauth();

  // Claim-state canary: track the distribution of email_verified=true vs.
  // false across all successfully-signed tokens that reach the gate. A
  // sudden shift in the ratio (e.g., 100% false right after deploy) signals
  // that api._sign_jwt is no longer setting the claim correctly. The
  // 'missing' state is structurally unreachable because requiredClaims fails
  // such tokens above with a 401, so the label set is exactly 'true' | 'false'.
  const claimIsTrue = payload['email_verified'] === true;
  jwtEmailVerifiedTotal.labels(claimIsTrue ? 'true' : 'false').inc();
  if (!claimIsTrue) {
    throw new EmailNotVerifiedError();
  }
  return { sub: String(payload.sub), email_verified: true };
}

function unauth(): Error & { statusCode: number } {
  return Object.assign(new Error('Unauthorized'), { statusCode: 401 });
}
