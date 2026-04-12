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
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      // PostgREST wraps DB RAISE EXCEPTION messages in { message }
      message = body.message ?? body.hint ?? message;
    } catch {
      // ignore parse errors
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
