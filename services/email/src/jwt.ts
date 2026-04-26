import { jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import { config } from './config.js';

const secretKey = createSecretKey(Buffer.from(config.JWT_SECRET, 'utf-8'));

export async function verifyJwt(authHeader: string | undefined): Promise<{ sub: string }> {
  if (!authHeader?.startsWith('Bearer ')) throw unauth();
  const token = authHeader.slice(7);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'role', 'exp'],
    }));
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
