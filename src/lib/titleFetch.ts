import { getToken } from './api';

/** Typed error union for the auto-fill flow. */
export type TitleFetchErrorKind =
  | 'auth'             // 401 — JWT missing / invalid / wrong audience
  | 'blocked'          // 422 — target rejected by the service (SSRF / content-type / size / redirect)
  | 'timeout'          // 504 — upstream fetch exceeded the service timeout
  | 'upstream'         // 502 — generic upstream failure (DNS / TLS / refused)
  | 'rate-limited'     // 429 — too many requests for this user
  | 'service-down'     // 503 — service-wide concurrency cap or container down
  | 'aborted'          // fetch was aborted via the supplied AbortSignal
  | 'network';         // fetch() itself rejected (offline / DNS down to our origin)

export class TitleFetchError extends Error {
  constructor(public kind: TitleFetchErrorKind) {
    super(kind);
    this.name = 'TitleFetchError';
  }
}

const ENDPOINT = '/api/title/';

function mapStatus(status: number): TitleFetchErrorKind {
  switch (status) {
    case 401: return 'auth';
    case 422: return 'blocked';
    case 429: return 'rate-limited';
    case 502: return 'upstream';
    case 503: return 'service-down';
    case 504: return 'timeout';
    default:  return 'upstream';
  }
}

/**
 * Fetch the page <title> for the given URL via the metadata-fetcher service.
 *
 * Returns the cleaned title string, or null if the service successfully
 * parsed the page but found no title (og:title / twitter:title / <title>
 * all empty). Throws TitleFetchError with a stable `kind` for any failure
 * — never relays raw upstream error strings to the UI.
 *
 * The supplied AbortSignal cancels the in-flight request; the resulting
 * TitleFetchError carries kind: 'aborted' so callers can suppress the
 * user-facing toast for an intentional abort.
 */
export async function fetchBookmarkTitle(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TitleFetchError('aborted');
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TitleFetchError('aborted');
    }
    throw new TitleFetchError('network');
  }

  if (!response.ok) {
    throw new TitleFetchError(mapStatus(response.status));
  }

  try {
    const body = (await response.json()) as { title?: unknown };
    if (typeof body.title === 'string') return body.title;
    if (body.title === null) return null;
    // Defensive: service returned an unexpected shape.
    throw new TitleFetchError('upstream');
  } catch (err) {
    if (err instanceof TitleFetchError) throw err;
    throw new TitleFetchError('upstream');
  }
}
