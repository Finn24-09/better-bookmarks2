import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchBookmarkTitle, TitleFetchError } from './titleFetch';
import { setAuthToken } from './api';

const TARGET_URL = 'https://example.com/page';

function mockFetch(impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
}

beforeEach(() => {
  setAuthToken('test-jwt');
});

afterEach(() => {
  setAuthToken(null);
  vi.restoreAllMocks();
});

describe('fetchBookmarkTitle — request shape', () => {
  it('POSTs to /api/title/ with { url } body and bearer header', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify({ title: 'X' }), { status: 200 }));
    await fetchBookmarkTitle(TARGET_URL);
    expect(spy).toHaveBeenCalledOnce();
    const [path, init] = spy.mock.calls[0];
    expect(path).toBe('/api/title/');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-jwt');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ url: TARGET_URL }));
    expect(init?.credentials).toBe('same-origin');
  });

  it('omits Authorization header when no token is set', async () => {
    setAuthToken(null);
    const spy = mockFetch(async () => new Response(JSON.stringify({ title: null }), { status: 200 }));
    await fetchBookmarkTitle(TARGET_URL);
    const [, init] = spy.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});

describe('fetchBookmarkTitle — success', () => {
  it('returns the title string on 200', async () => {
    mockFetch(async () => new Response(JSON.stringify({ title: 'Hello World' }), { status: 200 }));
    expect(await fetchBookmarkTitle(TARGET_URL)).toBe('Hello World');
  });

  it('returns null when service returns { title: null }', async () => {
    mockFetch(async () => new Response(JSON.stringify({ title: null }), { status: 200 }));
    expect(await fetchBookmarkTitle(TARGET_URL)).toBe(null);
  });
});

describe('fetchBookmarkTitle — error mapping', () => {
  const cases: Array<[number, TitleFetchError['kind']]> = [
    [401, 'auth'],
    [422, 'blocked'],
    [429, 'rate-limited'],
    [502, 'upstream'],
    [503, 'service-down'],
    [504, 'timeout'],
    [400, 'upstream'], // unmapped → generic upstream
    [500, 'upstream'],
  ];

  for (const [status, kind] of cases) {
    it(`maps ${status} → ${kind}`, async () => {
      mockFetch(async () => new Response('{"error":"…"}', { status }));
      try {
        await fetchBookmarkTitle(TARGET_URL);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TitleFetchError);
        expect((err as TitleFetchError).kind).toBe(kind);
      }
    });
  }

  it('maps network failure to kind: network', async () => {
    mockFetch(async () => { throw new TypeError('network failure'); });
    try {
      await fetchBookmarkTitle(TARGET_URL);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TitleFetchError).kind).toBe('network');
    }
  });

  it('maps AbortError to kind: aborted', async () => {
    mockFetch(async () => {
      const abortErr = new DOMException('aborted', 'AbortError');
      throw abortErr;
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await fetchBookmarkTitle(TARGET_URL, controller.signal);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TitleFetchError).kind).toBe('aborted');
    }
  });

  it('maps unexpected response shape to kind: upstream', async () => {
    mockFetch(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    try {
      await fetchBookmarkTitle(TARGET_URL);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TitleFetchError).kind).toBe('upstream');
    }
  });

  it('maps non-JSON success body to kind: upstream', async () => {
    mockFetch(async () => new Response('not json', { status: 200 }));
    try {
      await fetchBookmarkTitle(TARGET_URL);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TitleFetchError).kind).toBe('upstream');
    }
  });
});

describe('fetchBookmarkTitle — AbortSignal plumbing', () => {
  it('passes the signal to fetch', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify({ title: 'X' }), { status: 200 }));
    const controller = new AbortController();
    await fetchBookmarkTitle(TARGET_URL, controller.signal);
    const [, init] = spy.mock.calls[0];
    expect(init?.signal).toBe(controller.signal);
  });
});
