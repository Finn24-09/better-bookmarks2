import { getToken } from './api.js';

const BASE = '/api/email';

async function emailFetch(
  path: string,
  body?: Record<string, unknown>,
  auth = false,
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
