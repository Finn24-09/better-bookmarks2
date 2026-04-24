export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// In-memory token — intentionally never written to localStorage or sessionStorage.
// Keeping the JWT only in memory means an XSS script cannot read it from storage
// and replay it in a future session after the tab has closed.
let _token: string | null = null;

export function setAuthToken(token: string | null): void {
  _token = token;
}

/**
 * Base fetch wrapper. Prepends /api, injects Bearer token from memory,
 * and converts non-OK responses to ApiError using PostgREST's error format.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const response = await fetch(`/api${path}`, { ...options, headers });

  if (!response.ok) {
    // Relay raw PostgREST error messages only for auth RPCs where the messages
    // are intentional user-facing feedback from SQL functions (e.g. "invalid
    // credentials", "email already in use"). For all other paths, use generic
    // messages to avoid leaking DB schema details (column names, constraint names).
    const AUTH_RPC_PATHS = [
      '/rpc/sign_in',
      '/rpc/sign_up',
      '/rpc/change_password',
      '/rpc/delete_account',
    ];
    const isAuthRpc = AUTH_RPC_PATHS.some((p) => path.startsWith(p));

    const STATUS_MESSAGES: Record<number, string> = {
      401: 'Authentication required. Please sign in.',
      403: 'You do not have permission to perform this action.',
      404: 'The requested resource was not found.',
      429: 'Too many requests. Please wait a moment and try again.',
      500: 'An unexpected server error occurred. Please try again.',
      503: 'The service is temporarily unavailable. Please try again.',
    };

    let message = STATUS_MESSAGES[response.status] ?? `Request failed (${response.status})`;
    if (isAuthRpc && (response.status === 400 || response.status === 401 || response.status === 409)) {
      try {
        const body = await response.json();
        message = body.message ?? body.hint ?? message;
      } catch {
        // ignore parse errors — keep generic fallback
      }
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  // PostgREST returns 201 with an empty body for inserts that don't use
  // `Prefer: return=representation`. Catch the resulting SyntaxError so callers
  // don't need to add that header just to avoid a crash.
  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

/**
 * Makes a count-only request using PostgREST's `Prefer: count=exact` and reads
 * the total from the `Content-Range` response header. Returns null on any
 * failure so callers can degrade gracefully (show progress without a total).
 */
export async function apiFetchCount(path: string, signal?: AbortSignal): Promise<number | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Prefer: 'count=exact',
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  try {
    const response = await fetch(`/api${path}`, { headers, signal });
    if (!response.ok) return null;
    const contentRange = response.headers.get('Content-Range');
    if (!contentRange) return null;
    const match = contentRange.match(/\/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
