import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { validateUrl, type Resolver, type ValidationResult } from './ssrfGuard.js';
import { VERSION as _version } from './version.js';

// ---------------------------------------------------------------------------
// Hardened HTTP fetcher
//
// Wraps Node's http/https with the full set of defences:
//   - SSRF guard on every hop (initial + every redirect target).
//   - Dial by resolved IP; SNI / Host header use the original hostname.
//   - Outbound header allowlist — exactly Host / User-Agent / Accept /
//     Accept-Encoding (identity). Nothing from the inbound request.
//   - 3-redirect cap; HTTPS→HTTP downgrade rejected.
//   - 1 MiB body cap, enforced on the wire (before any Buffer.concat).
//   - 5 s wall-clock total timeout via AbortController.
//   - Content-Type: text/html or application/xhtml+xml only.
//   - Compressed responses rejected pre-decompression (gzip-bomb defence).
//   - TLS minVersion 1.2, default cert verification.
// ---------------------------------------------------------------------------

export class FetchTimeoutError extends Error { kind = 'timeout' as const; }
export class FetchBodyTooLargeError extends Error { kind = 'body-too-large' as const; }
export class FetchCompressedBodyError extends Error { kind = 'compressed-body' as const; }
export class FetchUnsupportedContentTypeError extends Error { kind = 'content-type-rejected' as const; }
export class FetchRedirectDowngradeError extends Error { kind = 'redirect-downgrade' as const; }
export class FetchTooManyRedirectsError extends Error { kind = 'redirect-loop' as const; }
export class FetchBlockedError extends Error { kind = 'blocked-host' as const; }
export class FetchUpstreamError extends Error { kind = 'upstream-error' as const; }

export type FetcherError =
  | FetchTimeoutError
  | FetchBodyTooLargeError
  | FetchCompressedBodyError
  | FetchUnsupportedContentTypeError
  | FetchRedirectDowngradeError
  | FetchTooManyRedirectsError
  | FetchBlockedError
  | FetchUpstreamError;

export interface FetchResult {
  bytes: Buffer;
  charset: string;
}

// Versionless UA — see spec §5.4. Includes a contact URL so upstream
// operators can reach the project before nullrouting the IP. No version,
// to avoid CVE-pinning targeting.
export const USER_AGENT = 'better-bookmarks-metadata-fetcher (+https://github.com/finn-marks/better-bookmarks2)';
// Silence unused-import warning while keeping VERSION exported indirectly via
// the runtime banner; UA is intentionally versionless.
void _version;

export const MAX_BODY_BYTES = 1 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const TOTAL_TIMEOUT_MS = 5_000;

const ALLOWED_CONTENT_TYPES = /^(?:text\/html|application\/xhtml\+xml)\b/i;

// ---------------------------------------------------------------------------
// Low-level dispatch — extracted into a function so tests can inject a mock.

export interface DispatchOpts {
  scheme: 'http:' | 'https:';
  ip: string;
  family: 4 | 6;
  host: string;
  port: number;
  pathQuery: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface DispatchResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

export type DispatchFn = (opts: DispatchOpts) => Promise<DispatchResponse>;

const realDispatch: DispatchFn = (opts) => {
  return new Promise((resolve, reject) => {
    const requestModule = opts.scheme === 'https:' ? https : http;
    const req = requestModule.request(
      {
        method: 'GET',
        host: opts.ip,
        port: opts.port,
        path: opts.pathQuery,
        headers: opts.headers,
        // TLS: dial by IP but verify SNI/cert against the original hostname.
        servername: opts.scheme === 'https:' ? opts.host : undefined,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        // Lookup callback returns the pre-resolved IP so Node does not
        // re-resolve the hostname (closes the DNS rebinding TOCTOU window).
        lookup: (_host, _options, cb) => {
          cb(null, opts.ip, opts.family);
        },
      } as http.RequestOptions & https.RequestOptions,
      (res) => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: res,
        });
      },
    );
    req.on('error', (err) => reject(err));
    opts.signal.addEventListener('abort', () => {
      req.destroy(opts.signal.reason);
    }, { once: true });
    req.end();
  });
};

// ---------------------------------------------------------------------------

export interface FetchOptions {
  resolver?: Resolver;
  dispatch?: DispatchFn;
  maxRedirects?: number;
  bodyLimitBytes?: number;
  timeoutMs?: number;
  /** Called with each redirect Location for test observability. */
  onHop?: (info: { url: string; host: string; ip: string }) => void;
}

function parseCharset(contentType: string | undefined): string {
  if (!contentType) return 'utf-8';
  const m = /charset=([^;\s]+)/i.exec(contentType);
  if (!m) return 'utf-8';
  return m[1].toLowerCase().replace(/^["']|["']$/g, '');
}

function isCompressed(headers: DispatchResponse['headers']): boolean {
  const encodingHeader = headers['content-encoding'];
  const encoding = Array.isArray(encodingHeader) ? encodingHeader.join(',') : encodingHeader;
  if (!encoding) return false;
  return /\b(?:gzip|br|deflate|compress)\b/i.test(encoding);
}

async function readBodyWithCap(
  res: DispatchResponse,
  cap: number,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    const abort = (err: Error) => {
      if (aborted) return;
      aborted = true;
      res.body.destroy(err);
      reject(err);
    };
    const onAbort = () => abort(new FetchTimeoutError('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    res.body.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        abort(new FetchBodyTooLargeError(`body exceeded ${cap} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    res.body.on('end', () => {
      if (aborted) return;
      signal.removeEventListener('abort', onAbort);
      resolve(Buffer.concat(chunks));
    });
    res.body.on('error', (err: Error) => {
      if (aborted) return;
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

interface ResolvedHop {
  scheme: 'http:' | 'https:';
  host: string;
  ip: string;
  family: 4 | 6;
  port: number;
  pathQuery: string;
  fullUrl: string;
}

function asResolved(v: ValidationResult, fullUrl: string): ResolvedHop | { ok: false } {
  if (!v.ok) return { ok: false };
  return {
    scheme: v.scheme,
    host: v.host,
    ip: v.dialIp,
    family: v.dialFamily,
    port: v.port,
    pathQuery: v.pathQuery,
    fullUrl,
  };
}

/**
 * Fetch the head bytes of a URL with full defensive layering. Throws a
 * typed FetcherError on any failure; the route handler maps each kind to
 * the appropriate HTTP status and sanitised error body.
 */
export async function fetchHead(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const resolver = opts.resolver;
  const dispatch = opts.dispatch ?? realDispatch;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const bodyLimit = opts.bodyLimitBytes ?? MAX_BODY_BYTES;
  const timeoutMs = opts.timeoutMs ?? TOTAL_TIMEOUT_MS;

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(new FetchTimeoutError('timeout')), timeoutMs);

  try {
    let currentUrl = url;
    let prevScheme: 'http:' | 'https:' | null = null;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const validation = await validateUrl(currentUrl, resolver);
      const resolved = asResolved(validation, currentUrl);
      if ('ok' in resolved && resolved.ok === false) {
        throw new FetchBlockedError(`target blocked: ${(validation as { reason: string }).reason}`);
      }
      const hopInfo = resolved as ResolvedHop;
      if (prevScheme === 'https:' && hopInfo.scheme === 'http:') {
        throw new FetchRedirectDowngradeError('redirect downgrades HTTPS to HTTP');
      }
      opts.onHop?.({ url: hopInfo.fullUrl, host: hopInfo.host, ip: hopInfo.ip });

      // Build closed-set outbound headers. NOTHING from the inbound request.
      const hostHeader = (hopInfo.scheme === 'http:' && hopInfo.port === 80) || (hopInfo.scheme === 'https:' && hopInfo.port === 443)
        ? hopInfo.host
        : `${hopInfo.host}:${hopInfo.port}`;
      const headers: Record<string, string> = {
        Host: hostHeader,
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
      };

      let res: DispatchResponse;
      try {
        res = await dispatch({
          scheme: hopInfo.scheme,
          ip: hopInfo.ip,
          family: hopInfo.family,
          host: hopInfo.host,
          port: hopInfo.port,
          pathQuery: hopInfo.pathQuery,
          headers,
          signal: abortController.signal,
        });
      } catch (err) {
        // The dispatch can fail in three classes:
        //   1. Our own abort fired (timeout) — signal.aborted is true and
        //      signal.reason carries the FetchTimeoutError we constructed.
        //   2. AbortError surfaced from undici/native (treat as timeout).
        //   3. Real network / TLS failure (upstream-error).
        if (abortController.signal.aborted && abortController.signal.reason instanceof FetchTimeoutError) {
          throw abortController.signal.reason;
        }
        if (err instanceof FetchTimeoutError) throw err;
        if (err instanceof Error && (err as { name?: string }).name === 'AbortError') {
          throw new FetchTimeoutError('timeout');
        }
        throw new FetchUpstreamError('upstream dispatch failed');
      }

      // Status-code policy.
      const status = res.statusCode;
      if (status >= 300 && status < 400) {
        const locationHeader = res.headers['location'];
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        if (!location) {
          // Drain and reject as upstream-policy failure.
          res.body.resume();
          throw new FetchUpstreamError('3xx without Location header');
        }
        // Discard the redirect body — we don't read it.
        res.body.resume();
        if (hop >= maxRedirects) {
          throw new FetchTooManyRedirectsError(`exceeded ${maxRedirects} redirects`);
        }
        let next: URL;
        try {
          next = new URL(location, hopInfo.fullUrl);
        } catch {
          throw new FetchUpstreamError('invalid Location header');
        }
        prevScheme = hopInfo.scheme;
        currentUrl = next.href;
        continue;
      }
      if (status !== 200) {
        res.body.resume();
        throw new FetchUpstreamError(`upstream status ${status}`);
      }

      // Compression rejection (gzip-bomb defence) BEFORE reading body.
      if (isCompressed(res.headers)) {
        res.body.resume();
        throw new FetchCompressedBodyError('compressed response not supported');
      }

      // Content-Type check.
      const ctHeader = res.headers['content-type'];
      const contentType = Array.isArray(ctHeader) ? ctHeader[0] : ctHeader;
      if (!contentType || !ALLOWED_CONTENT_TYPES.test(contentType)) {
        res.body.resume();
        throw new FetchUnsupportedContentTypeError(`content-type not allowed: ${contentType ?? 'missing'}`);
      }

      const charset = parseCharset(contentType);
      const bytes = await readBodyWithCap(res, bodyLimit, abortController.signal);
      return { bytes, charset };
    }
    // Should be unreachable — loop exits via return or throw.
    throw new FetchTooManyRedirectsError(`exceeded ${maxRedirects} redirects`);
  } finally {
    clearTimeout(timer);
  }
}
