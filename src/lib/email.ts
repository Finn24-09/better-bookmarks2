import { getToken } from './api.js';

const BASE = '/api/email';

async function emailFetch(
  path: string,
  body?: Record<string, unknown>,
  auth = false,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await emailFetch('/request-reset', { email });
}

export async function resendVerificationEmail(): Promise<void> {
  // fetch() does NOT reject on non-2xx responses — without this guard the
  // banner's catch branch only fires on network failures, so server-side
  // 429 (cooldown hit) and 500 (sendMail failure) would silently look like
  // success to the user. Match the requestAccountDeletion() pattern below.
  const res = await emailFetch('/resend-verification', {}, true);
  if (!res.ok) throw new Error('Failed to resend verification email');
}

export async function requestAccountDeletion(): Promise<void> {
  const res = await emailFetch('/request-delete', {}, true);
  if (!res.ok) throw new Error('Failed to send deletion email');
}

export async function confirmAccountDeletion(
  token: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await emailFetch('/confirm-delete', { token, password }, true);
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return { ok: false, error: (body as { error?: string }).error ?? 'Deletion failed' };
}

export async function notifyPasswordChanged(): Promise<void> {
  await emailFetch('/notify-password-change', {}, true).catch(() => {});
}

/**
 * Called by the SPA immediately after the verify-email redirect lands on
 * the verification-success hash. POSTs to the email service which calls
 * auth.mint_post_verify_jwt and returns a fresh JWT carrying
 * email_verified=true so the SPA can swap its in-memory token and start
 * calling /api/title/ without waiting for next sign-in.
 *
 * Returns null for any failure (410 expired window, 404 route not yet
 * deployed, network error, AbortError from a cancelled in-flight request,
 * malformed body). Failure is non-fatal here because the verification
 * itself already succeeded — the user falls back to the next-sign-in
 * claim refresh path, which is the same behaviour they would have if
 * this route did not exist. The caller silently no-ops on null; we never
 * surface an error toast for this case.
 *
 * The optional AbortSignal lets a caller cancel an in-flight request
 * (e.g. on React effect cleanup after logout). The browser tears down
 * the socket and fetch rejects with AbortError; the catch below maps
 * any rejection — including AbortError — to null so callers see a
 * uniform contract.
 *
 * A 200 response with an unexpected body shape leaves a console.warn
 * breadcrumb (no PII, no token) so a future server-side regression that
 * emits the wrong shape surfaces in dev tools without being masked by
 * the silent fallback. The same condition still returns null for the
 * caller — the breadcrumb is for ops, not UX.
 */
export async function refreshAfterVerify(signal?: AbortSignal): Promise<{ token: string } | null> {
  let res: Response;
  try {
    res = await emailFetch('/refresh-after-verify', {}, true, signal);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    console.warn('refreshAfterVerify: 200 with non-JSON body');
    return null;
  }
  if (!body || typeof body !== 'object') {
    console.warn('refreshAfterVerify: 200 with non-object body');
    return null;
  }
  const { token } = body as { token?: unknown };
  if (typeof token !== 'string') {
    console.warn('refreshAfterVerify: 200 with missing or non-string token');
    return null;
  }
  return { token };
}
