import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { LookupAddress } from 'node:dns';
import {
  fetchHead,
  type DispatchFn,
  type DispatchOpts,
  type DispatchResponse,
  FetchBlockedError,
  FetchBodyTooLargeError,
  FetchCompressedBodyError,
  FetchUnsupportedContentTypeError,
  FetchRedirectDowngradeError,
  FetchTooManyRedirectsError,
  FetchTimeoutError,
  FetchUpstreamError,
  USER_AGENT,
} from './fetcher.js';

function publicResolver(_host: string): Promise<LookupAddress[]> {
  return Promise.resolve([{ address: '8.8.8.8', family: 4 }]);
}

function privateResolver(_host: string): Promise<LookupAddress[]> {
  return Promise.resolve([{ address: '10.0.0.5', family: 4 }]);
}

function bodyStream(html: string | Buffer): Readable {
  const chunk = typeof html === 'string' ? Buffer.from(html, 'utf-8') : html;
  return Readable.from([chunk]);
}

function okResponse(html: string, ct = 'text/html; charset=utf-8'): DispatchResponse {
  return {
    statusCode: 200,
    headers: { 'content-type': ct },
    body: bodyStream(html),
  };
}

function captureDispatch(canned: (call: DispatchOpts, callIndex: number) => DispatchResponse): {
  dispatch: DispatchFn;
  calls: DispatchOpts[];
} {
  const calls: DispatchOpts[] = [];
  const dispatch: DispatchFn = async (opts) => {
    const idx = calls.length;
    calls.push(opts);
    return canned(opts, idx);
  };
  return { dispatch, calls };
}

describe('fetcher — outbound header allowlist', () => {
  it('sends exactly Host / User-Agent / Accept / Accept-Encoding and nothing else', async () => {
    const { dispatch, calls } = captureDispatch(() => okResponse('<title>X</title>'));
    await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(calls).toHaveLength(1);
    const headerKeys = Object.keys(calls[0].headers).sort();
    expect(headerKeys).toEqual(['Accept', 'Accept-Encoding', 'Host', 'User-Agent']);
  });

  it('never forwards Authorization / Cookie / X-Forwarded-* / Referer / Accept-Language', async () => {
    const { dispatch, calls } = captureDispatch(() => okResponse('<title>X</title>'));
    await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    const h = calls[0].headers;
    expect(h['Authorization']).toBeUndefined();
    expect(h['Cookie']).toBeUndefined();
    expect(h['X-Forwarded-For']).toBeUndefined();
    expect(h['X-Real-IP']).toBeUndefined();
    expect(h['Referer']).toBeUndefined();
    expect(h['Accept-Language']).toBeUndefined();
  });

  it('User-Agent is the versionless project string with contact URL', async () => {
    const { dispatch, calls } = captureDispatch(() => okResponse('<title>X</title>'));
    await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(calls[0].headers['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).not.toMatch(/\d+\.\d+\.\d+/);
    expect(USER_AGENT).toContain('+https://');
  });

  it('Accept-Encoding is identity (no gzip)', async () => {
    const { dispatch, calls } = captureDispatch(() => okResponse('<title>X</title>'));
    await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(calls[0].headers['Accept-Encoding']).toBe('identity');
  });

  it('dials by the resolved IP, not by hostname', async () => {
    const { dispatch, calls } = captureDispatch(() => okResponse('<title>X</title>'));
    await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(calls[0].ip).toBe('8.8.8.8');
    expect(calls[0].host).toBe('example.com');
  });

  it('Host header omits default ports', async () => {
    const { dispatch, calls } = captureDispatch(() => okResponse('<title>X</title>'));
    await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(calls[0].headers.Host).toBe('example.com');
  });
});

describe('fetcher — SSRF guard integration', () => {
  it('rejects an SSRF-flagged URL with FetchBlockedError before any dispatch', async () => {
    let dispatched = false;
    const dispatch: DispatchFn = async () => { dispatched = true; return okResponse(''); };
    await expect(
      fetchHead('http://10.0.0.1/', { resolver: privateResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchBlockedError);
    expect(dispatched).toBe(false);
  });

  it('rejects a redirect target that resolves to a private IP without a second dispatch', async () => {
    let counter = 0;
    const resolver = async (host: string): Promise<LookupAddress[]> => {
      if (host === 'public.example') return [{ address: '8.8.8.8', family: 4 }];
      if (host === 'internal.example') return [{ address: '10.0.0.5', family: 4 }];
      throw new Error(`unexpected host: ${host}`);
    };
    const dispatch: DispatchFn = async () => {
      counter++;
      return {
        statusCode: 302,
        headers: { location: 'http://internal.example/' },
        body: bodyStream(''),
      };
    };
    await expect(
      fetchHead('http://public.example/', { resolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchBlockedError);
    expect(counter).toBe(1); // first hop went out, second hop blocked pre-dispatch
  });
});

describe('fetcher — redirects', () => {
  it('follows up to 3 redirects', async () => {
    const responses: DispatchResponse[] = [
      { statusCode: 302, headers: { location: 'https://example.com/2' }, body: bodyStream('') },
      { statusCode: 302, headers: { location: 'https://example.com/3' }, body: bodyStream('') },
      { statusCode: 302, headers: { location: 'https://example.com/4' }, body: bodyStream('') },
      okResponse('<title>final</title>'),
    ];
    let i = 0;
    const dispatch: DispatchFn = async () => responses[i++];
    const r = await fetchHead('https://example.com/1', { resolver: publicResolver, dispatch });
    expect(r.bytes.toString()).toContain('<title>final</title>');
  });

  it('rejects on the 4th redirect with FetchTooManyRedirectsError', async () => {
    let i = 0;
    const dispatch: DispatchFn = async () => ({
      statusCode: 302,
      headers: { location: `https://example.com/${++i}` },
      body: bodyStream(''),
    });
    await expect(
      fetchHead('https://example.com/0', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchTooManyRedirectsError);
  });

  it('rejects HTTPS → HTTP redirect downgrade', async () => {
    const responses: DispatchResponse[] = [
      { statusCode: 302, headers: { location: 'http://example.com/insecure' }, body: bodyStream('') },
    ];
    let i = 0;
    const dispatch: DispatchFn = async () => responses[i++];
    await expect(
      fetchHead('https://example.com/secure', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchRedirectDowngradeError);
  });

  it('redirect re-resolution: second hop uses the new hostname for Host and SNI', async () => {
    const resolver = async (host: string): Promise<LookupAddress[]> => {
      if (host === 'first.example') return [{ address: '8.8.8.8', family: 4 }];
      if (host === 'second.example') return [{ address: '1.1.1.1', family: 4 }];
      throw new Error(`unexpected host: ${host}`);
    };
    const { dispatch, calls } = captureDispatch((_o, idx) => {
      if (idx === 0) {
        return { statusCode: 302, headers: { location: 'https://second.example/page' }, body: bodyStream('') };
      }
      return okResponse('<title>second-host</title>');
    });
    await fetchHead('https://first.example/', { resolver, dispatch });
    expect(calls).toHaveLength(2);
    expect(calls[0].host).toBe('first.example');
    expect(calls[0].ip).toBe('8.8.8.8');
    expect(calls[1].host).toBe('second.example');
    expect(calls[1].ip).toBe('1.1.1.1');
    expect(calls[1].headers.Host).toBe('second.example');
  });

  it('3xx without Location → FetchUpstreamError', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 302,
      headers: {},
      body: bodyStream(''),
    });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchUpstreamError);
  });
});

describe('fetcher — content-type and compression', () => {
  it('rejects application/pdf with FetchUnsupportedContentTypeError', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/pdf' },
      body: bodyStream('%PDF-1.4'),
    });
    await expect(
      fetchHead('https://example.com/x.pdf', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchUnsupportedContentTypeError);
  });

  it('rejects gzip-encoded responses with FetchCompressedBodyError', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      body: bodyStream('compressed'),
    });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchCompressedBodyError);
  });

  it('rejects br-encoded responses', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html', 'content-encoding': 'br' },
      body: bodyStream('compressed'),
    });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchCompressedBodyError);
  });

  it('accepts application/xhtml+xml', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'application/xhtml+xml' },
      body: bodyStream('<title>xhtml</title>'),
    });
    const r = await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(r.bytes.toString()).toContain('xhtml');
  });

  it('reports the declared charset', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      body: bodyStream(Buffer.from([0xE9])),
    });
    const r = await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(r.charset).toBe('iso-8859-1');
  });

  it('defaults charset to utf-8 when not declared', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: bodyStream('<title>X</title>'),
    });
    const r = await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(r.charset).toBe('utf-8');
  });
});

describe('fetcher — response status policy', () => {
  it('204 → FetchUpstreamError', async () => {
    const dispatch: DispatchFn = async () => ({ statusCode: 204, headers: {}, body: bodyStream('') });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchUpstreamError);
  });

  it('304 → FetchUpstreamError', async () => {
    const dispatch: DispatchFn = async () => ({ statusCode: 304, headers: {}, body: bodyStream('') });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchUpstreamError);
  });

  it('500 → FetchUpstreamError', async () => {
    const dispatch: DispatchFn = async () => ({ statusCode: 500, headers: {}, body: bodyStream('') });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchUpstreamError);
  });

  it('connection error → FetchUpstreamError', async () => {
    const dispatch: DispatchFn = async () => { throw new Error('ECONNREFUSED'); };
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch }),
    ).rejects.toBeInstanceOf(FetchUpstreamError);
  });
});

describe('fetcher — body size cap', () => {
  it('aborts the stream once body exceeds the cap (no </head> backstop)', async () => {
    // Body with NO </head> token so the early-stop never fires; cap path
    // is the only way out. 6 × 256 KiB = 1.5 MiB; override cap to 1 MiB.
    const big = Buffer.alloc(1024 * 256, 0x61);
    const stream = new Readable({
      read() {
        let emitted = 0;
        const id = setInterval(() => {
          if (emitted >= 6) {
            clearInterval(id);
            this.push(null);
            return;
          }
          this.push(big);
          emitted++;
        }, 0);
      },
    });
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: stream,
    });
    await expect(
      fetchHead('https://example.com/', {
        resolver: publicResolver,
        dispatch,
        bodyLimitBytes: 1 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(FetchBodyTooLargeError);
  });

  it('respects a custom bodyLimitBytes override', async () => {
    // 1 KiB of `x` bytes — no </head>, so early-stop never fires.
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: bodyStream('x'.repeat(1024)),
    });
    await expect(
      fetchHead('https://example.com/', { resolver: publicResolver, dispatch, bodyLimitBytes: 100 }),
    ).rejects.toBeInstanceOf(FetchBodyTooLargeError);
  });
});

describe('fetcher — streaming early-stop on </head>', () => {
  it('5 MiB body with </head> at 100 KiB succeeds without reading past head', async () => {
    // Construct a body that would blow past any reasonable cap if read in
    // full, but whose <head> ends at byte ~100 KiB. The early-stop path
    // should resolve well before the cap fires.
    const head = `<head>${'a'.repeat(100 * 1024)}<title>Early Stop OK</title></head>`;
    const headBuf = Buffer.from(head, 'utf-8');
    const filler = Buffer.alloc(256 * 1024, 0x61);
    let chunksEmitted = 0;
    const stream = new Readable({
      read() {
        if (chunksEmitted === 0) {
          this.push(headBuf);
          chunksEmitted++;
          return;
        }
        if (chunksEmitted >= 20) {           // 20 × 256 KiB = 5 MiB filler
          this.push(null);
          return;
        }
        this.push(filler);
        chunksEmitted++;
      },
    });
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: stream,
    });
    const r = await fetchHead('https://example.com/', {
      resolver: publicResolver,
      dispatch,
      bodyLimitBytes: 1 * 1024 * 1024,    // cap below total body — proves early-stop
    });
    expect(r.bytes.toString('utf-8')).toContain('<title>Early Stop OK</title>');
    // Buffer is bounded by the head size + at most one chunk of overshoot,
    // never the full 5 MiB body.
    expect(r.bytes.length).toBeLessThan(headBuf.length + 256 * 1024);
  });

  it('</head> split across two chunks still triggers early-stop', async () => {
    // Split exactly so the tag boundary lands in the middle of `</head>`.
    // Chunks are kept under the per-chunk size guard. The point of the
    // test is that the head-end token straddles the chunk boundary —
    // total size is irrelevant once we've proved the tail-overlap works.
    const before = `<head><title>Split Test</title></hea`;
    const after = `d><body>kept</body>`;
    const stream = new Readable({
      read() {
        this.push(Buffer.from(before, 'utf-8'));
        this.push(Buffer.from(after, 'utf-8'));
        this.push(null);
      },
    });
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: stream,
    });
    const r = await fetchHead('https://example.com/', {
      resolver: publicResolver,
      dispatch,
      bodyLimitBytes: 1 * 1024 * 1024,
    });
    expect(r.bytes.toString('utf-8')).toContain('Split Test');
  });

  it('single chunk larger than the cap is rejected even if </head> is at offset 0', async () => {
    // Defends against a hostile upstream coalescing a giant frame to bypass
    // the cumulative-total cap via the search-before-cap path. Per-chunk
    // ceiling fires regardless of head position inside the chunk.
    const huge = Buffer.concat([
      Buffer.from('</head>filler', 'utf-8'),
      Buffer.alloc(3 * 1024 * 1024, 0x61),         // 3 MiB filler
    ]);
    const stream = new Readable({
      read() { this.push(huge); this.push(null); },
    });
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: stream,
    });
    await expect(
      fetchHead('https://example.com/', {
        resolver: publicResolver,
        dispatch,
        bodyLimitBytes: 2 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(FetchBodyTooLargeError);
  });

  it('reports terminationReason head-close on </head> match', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: bodyStream('<head><title>X</title></head><body>y</body>'),
    });
    const r = await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(r.terminationReason).toBe('head-close');
  });

  it('reports terminationReason body-open when </head> is omitted', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: bodyStream('<head><title>X</title><body>y</body>'),
    });
    const r = await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(r.terminationReason).toBe('body-open');
  });

  it('reports terminationReason eof for a tiny response with no head-end token', async () => {
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: bodyStream('<title>tiny</title>'),    // no </head>, no <body>
    });
    const r = await fetchHead('https://example.com/', { resolver: publicResolver, dispatch });
    expect(r.terminationReason).toBe('eof');
  });

  it('<body> opener triggers early-stop when </head> is omitted (HTML5)', async () => {
    // HTML5 makes </head> optional in source; a <body> open implies head end.
    // Body kept compact so the chunk fits under the per-chunk cap; the
    // test's intent is that <body[\s>] triggers early-stop when </head>
    // is missing, not that the body is large.
    const body = `<head><meta property="og:title" content="No End-Head"><body>kept</body>`;
    const stream = new Readable({
      read() {
        this.push(Buffer.from(body, 'utf-8'));
        this.push(null);
      },
    });
    const dispatch: DispatchFn = async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: stream,
    });
    const r = await fetchHead('https://example.com/', {
      resolver: publicResolver,
      dispatch,
      bodyLimitBytes: 1 * 1024 * 1024,
    });
    expect(r.bytes.toString('utf-8')).toContain('No End-Head');
  });
});

describe('fetcher — timeout', () => {
  it('aborts after timeoutMs and throws FetchTimeoutError', async () => {
    const stream = new Readable({ read() { /* never emits */ } });
    const dispatch: DispatchFn = async (opts) => {
      // Hold the body open indefinitely; abort signal should fire.
      opts.signal.addEventListener('abort', () => stream.destroy(opts.signal.reason));
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: stream,
      };
    };
    await expect(
      fetchHead('https://example.com/', {
        resolver: publicResolver,
        dispatch,
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });
});

describe('fetcher — onHop observability', () => {
  it('reports each hop with url/host/ip', async () => {
    const resolver = async (host: string): Promise<LookupAddress[]> =>
      host === 'a.example'
        ? [{ address: '8.8.8.8', family: 4 }]
        : [{ address: '1.1.1.1', family: 4 }];
    let i = 0;
    const dispatch: DispatchFn = async () => i++ === 0
      ? { statusCode: 302, headers: { location: 'https://b.example/' }, body: bodyStream('') }
      : okResponse('<title>ok</title>');
    const hops: Array<{ url: string; host: string; ip: string }> = [];
    await fetchHead('https://a.example/', { resolver, dispatch, onHop: h => hops.push(h) });
    expect(hops).toHaveLength(2);
    expect(hops[0].host).toBe('a.example');
    expect(hops[0].ip).toBe('8.8.8.8');
    expect(hops[1].host).toBe('b.example');
    expect(hops[1].ip).toBe('1.1.1.1');
  });
});

describe('FetchUpstreamError cause preservation (Task 8)', () => {
  it('chains the original dispatch error as `cause` on FetchUpstreamError', async () => {
    const original = new Error('ECONNREFUSED 1.2.3.4:443');
    const failingDispatch: DispatchFn = () => Promise.reject(original);
    let caught: unknown;
    try {
      await fetchHead('https://example.com/', {
        dispatch: failingDispatch,
        resolver: async () => [{ address: '1.2.3.4', family: 4 } as LookupAddress],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FetchUpstreamError);
    expect((caught as FetchUpstreamError).cause).toBe(original);
  });
});
