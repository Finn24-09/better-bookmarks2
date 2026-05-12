import { jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import { config } from './config.js';

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

export async function verifyJwt(authHeader: string | undefined): Promise<{ sub: string }> {
  if (!authHeader?.startsWith('Bearer ')) throw unauth();
  const token = authHeader.slice(7);
  let payload: Record<string, unknown>;
  try {
    const verifyOptions: Parameters<typeof jwtVerify>[2] = {
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'role', 'exp'],
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
  return { sub: String(payload.sub) };
}

function unauth(): Error & { statusCode: number } {
  return Object.assign(new Error('Unauthorized'), { statusCode: 401 });
}
