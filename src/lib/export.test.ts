import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted by Vitest before any imports
// ---------------------------------------------------------------------------

// Keep the real ApiError class so retry-classification tests can construct
// genuine status-carrying errors, but stub the two network entry points.
vi.mock('./api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./api')>();
  return { ...mod, apiFetch: vi.fn(), apiFetchCount: vi.fn().mockResolvedValue(null) };
});

vi.mock('./bookmarks', () => ({
  getBookmarks: vi.fn(),
}));

vi.mock('./tags', () => ({
  getTags: vi.fn().mockResolvedValue([]),
}));

// Keep real crypto helpers (bytesToBase64, etc.) but stub decryptBinary
vi.mock('./crypto', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./crypto')>();
  return { ...mod, decryptBinary: vi.fn() };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { apiFetch, apiFetchCount, ApiError } from './api';
import { getBookmarks } from './bookmarks';
import { getTags } from './tags';
import { decryptBinary } from './crypto';
import {
  exportBookmarks,
  exportToCsv,
  triggerDownload,
  type ExportOptions,
  type ExportData,
} from './export';
import type { Bookmark } from './bookmarks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: ExportOptions = {
  format: 'json',
  includeThumbnails: false,
  thumbnailErrorPolicy: 'skip',
};

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: `bm-${Math.random().toString(36).slice(2)}`,
    title: 'Test Bookmark',
    url: 'https://example.com',
    thumbnailUrl: null,
    thumbnailFileId: null,
    thumbnailOriginalName: null,
    tagIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeExportData(overrides: Partial<ExportData> = {}): ExportData {
  return {
    version: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    totalBookmarks: 0,
    bookmarks: [],
    ...overrides,
  };
}

// Fake CryptoKey for tests (export.ts only passes it through to mocked functions)
const FAKE_KEY = {} as CryptoKey;

// Valid JPEG magic bytes
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
// Bytes that are NOT a valid JPEG
const NON_JPEG_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiFetchCount).mockResolvedValue(null);
  vi.mocked(getTags).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('exportBookmarks — pagination', () => {
  it('fetches a single page when total fits in one call', async () => {
    const bookmarks = [makeBookmark(), makeBookmark()];
    vi.mocked(getBookmarks).mockResolvedValueOnce(bookmarks); // page 1 (short → last page)

    const result = await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS);

    expect(vi.mocked(getBookmarks)).toHaveBeenCalledTimes(1);
    expect(result.totalBookmarks).toBe(2);
    expect(result.bookmarks).toHaveLength(2);
  });

  it('loops across multiple pages with correct offsets', async () => {
    const page1 = Array.from({ length: 100 }, () => makeBookmark());
    const page2 = Array.from({ length: 100 }, () => makeBookmark());
    const page3 = [makeBookmark()]; // short → last page

    vi.mocked(getBookmarks)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);

    const result = await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS);

    expect(vi.mocked(getBookmarks)).toHaveBeenCalledTimes(3);
    // Each call gets the right offset
    const calls = vi.mocked(getBookmarks).mock.calls;
    expect(calls[0][1]).toMatchObject({ offset: 0 });
    expect(calls[1][1]).toMatchObject({ offset: 100 });
    expect(calls[2][1]).toMatchObject({ offset: 200 });
    expect(result.totalBookmarks).toBe(201);
  });

  it('onProgress is called once per page with accumulated current count', async () => {
    const page1 = Array.from({ length: 100 }, () => makeBookmark());
    const page2 = [makeBookmark()];
    vi.mocked(getBookmarks)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    vi.mocked(apiFetchCount).mockResolvedValue(101);

    const progress = vi.fn();
    await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS, progress);

    const bookmarkCalls = progress.mock.calls.filter(
      ([p]) => p.phase === 'bookmarks',
    );
    expect(bookmarkCalls[0][0]).toMatchObject({ phase: 'bookmarks', current: 100, total: 101 });
    expect(bookmarkCalls[1][0]).toMatchObject({ phase: 'bookmarks', current: 101, total: 101 });
  });

  it('uses total from apiFetchCount in progress events', async () => {
    vi.mocked(apiFetchCount).mockResolvedValue(247);
    vi.mocked(getBookmarks).mockResolvedValueOnce([makeBookmark()]); // short page

    const progress = vi.fn();
    await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS, progress);

    const [firstBookmarkCall] = progress.mock.calls.filter(([p]) => p.phase === 'bookmarks');
    expect(firstBookmarkCall[0].total).toBe(247);
  });

  it('rejects with a message containing the failed offset when a page fetch fails', async () => {
    const page1 = Array.from({ length: 100 }, () => makeBookmark());
    vi.mocked(getBookmarks)
      .mockResolvedValueOnce(page1)
      .mockRejectedValueOnce(new Error('network error'));

    await expect(exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS)).rejects.toThrow();
  });

  it('aborts the export and throws when the page count exceeds the safety ceiling (CR-024)', async () => {
    // Server (or our own mock) keeps returning a full page forever. Without
    // a ceiling this would loop until the heap dies; the new MAX_PAGES guard
    // must throw before then.
    const fullPage = Array.from({ length: 100 }, () => makeBookmark());
    vi.mocked(getBookmarks).mockResolvedValue(fullPage);

    await expect(exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS)).rejects.toThrow(/maximum/i);
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('exportBookmarks — cancellation', () => {
  it('rejects immediately with AbortError when signal is pre-aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS, undefined, ctrl.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(vi.mocked(getBookmarks)).not.toHaveBeenCalled();
  });

  it('stops pagination when signal is aborted between pages', async () => {
    const ctrl = new AbortController();
    const page1 = Array.from({ length: 100 }, () => makeBookmark());

    vi.mocked(getBookmarks).mockImplementation(async (_key, opts) => {
      if (opts?.offset === 0) {
        ctrl.abort(); // abort after first page resolves
        return page1;
      }
      return [makeBookmark()];
    });

    await expect(exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS, undefined, ctrl.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    // Only the first page was fetched
    expect(vi.mocked(getBookmarks)).toHaveBeenCalledTimes(1);
  });

  it('stops thumbnail fetches when signal is aborted mid-thumbnail', async () => {
    const ctrl = new AbortController();
    const bookmarks = Array.from({ length: 3 }, (_, i) =>
      makeBookmark({ thumbnailFileId: `img-${i}` }),
    );
    vi.mocked(getBookmarks).mockResolvedValueOnce(bookmarks);

    let callCount = 0;
    vi.mocked(apiFetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) ctrl.abort(); // abort after first thumbnail fetch
      return [{ data_enc: 'enc' }];
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const options: ExportOptions = { ...DEFAULT_OPTIONS, includeThumbnails: true };
    await expect(exportBookmarks(FAKE_KEY, options, undefined, ctrl.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    // Not all 3 thumbnails were fetched
    expect(callCount).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// Thumbnail handling
// ---------------------------------------------------------------------------

describe('exportBookmarks — thumbnails', () => {
  it('does not fetch thumbnail data when includeThumbnails is false', async () => {
    const bm = makeBookmark({ thumbnailFileId: 'img-1' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);

    await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: false });

    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('passes through direct thumbnailUrl as-is when includeThumbnails is false', async () => {
    const bm = makeBookmark({ thumbnailUrl: 'https://example.com/img.jpg' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);

    const result = await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: false });

    expect(result.bookmarks[0].thumbnail).toEqual({ type: 'url', value: 'https://example.com/img.jpg' });
  });

  it('passes through direct thumbnailUrl as-is when includeThumbnails is true (no file)', async () => {
    const bm = makeBookmark({ thumbnailUrl: 'https://example.com/img.jpg' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);

    const result = await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    expect(result.bookmarks[0].thumbnail).toEqual({ type: 'url', value: 'https://example.com/img.jpg' });
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('embeds uploaded thumbnail as data URI when includeThumbnails is true', async () => {
    const bm = makeBookmark({ thumbnailFileId: 'img-1', thumbnailOriginalName: 'photo.jpg' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);
    vi.mocked(apiFetch).mockResolvedValue([{ id: 'img-1', data_enc: 'encrypted' }]);
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const result = await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    const thumb = result.bookmarks[0].thumbnail;
    expect(thumb?.type).toBe('data');
    if (thumb?.type === 'data') {
      expect(thumb.value).toMatch(/^data:image\/jpeg;base64,/);
      expect(thumb.originalName).toBe('photo.jpg');
    }
  });

  it('apiFetch is called with the correct thumbnail_images endpoint', async () => {
    const bm = makeBookmark({ thumbnailFileId: 'img-abc' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);
    vi.mocked(apiFetch).mockResolvedValue([{ id: 'img-abc', data_enc: 'enc' }]);
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
      expect.stringContaining('/thumbnail_images?id=in.(img-abc)'),
      expect.anything(),
    );
  });

  it('skips thumbnail with non-JPEG magic bytes when thumbnailErrorPolicy is skip', async () => {
    const bm = makeBookmark({ thumbnailFileId: 'img-bad' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);
    vi.mocked(apiFetch).mockResolvedValue([{ data_enc: 'enc' }]);
    vi.mocked(decryptBinary).mockResolvedValue(NON_JPEG_BYTES);

    const result = await exportBookmarks(
      FAKE_KEY,
      { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailErrorPolicy: 'skip' },
    );

    expect(result.bookmarks[0].thumbnail).toBeNull();
  });

  it('rejects with non-JPEG magic bytes when thumbnailErrorPolicy is abort', async () => {
    const bm = makeBookmark({ thumbnailFileId: 'img-bad' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);
    vi.mocked(apiFetch).mockResolvedValue([{ data_enc: 'enc' }]);
    vi.mocked(decryptBinary).mockResolvedValue(NON_JPEG_BYTES);

    await expect(
      exportBookmarks(
        FAKE_KEY,
        { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailErrorPolicy: 'abort' },
      ),
    ).rejects.toThrow();
  });

  it('thumbnailErrorPolicy skip: a whole-batch fetch failure is still fatal', async () => {
    const bm1 = makeBookmark({ id: 'bm-1', thumbnailFileId: 'img-1' });
    const bm2 = makeBookmark({ id: 'bm-2', thumbnailFileId: 'img-2' });
    const bm3 = makeBookmark({ id: 'bm-3', thumbnailFileId: 'img-3' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm1, bm2, bm3]);

    vi.mocked(apiFetch).mockRejectedValue(new Error('fetch failed'));
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    // The skip policy covers per-row defects only. A batch that cannot be read
    // at all would silently drop every thumbnail in it, which is exactly the
    // backup-looks-complete-but-isn't failure this export had.
    await expect(
      exportBookmarks(
        FAKE_KEY,
        { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailErrorPolicy: 'skip' },
      ),
    ).rejects.toThrow('fetch failed');
  });

  it('thumbnailErrorPolicy abort: rejects on first thumbnail failure', async () => {
    const bm1 = makeBookmark({ thumbnailFileId: 'img-1' });
    const bm2 = makeBookmark({ thumbnailFileId: 'img-2' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm1, bm2]);

    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if ((path as string).includes('img-1')) throw new Error('fetch failed');
      return [{ data_enc: 'enc' }];
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await expect(
      exportBookmarks(
        FAKE_KEY,
        { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailErrorPolicy: 'abort' },
      ),
    ).rejects.toThrow('fetch failed');
  });

  it('progress is emitted for each thumbnail processed', async () => {
    const bookmarks = Array.from({ length: 3 }, () =>
      makeBookmark({ thumbnailFileId: `img-${Math.random()}` }),
    );
    vi.mocked(getBookmarks).mockResolvedValueOnce(bookmarks);
    vi.mocked(apiFetch).mockResolvedValue([{ data_enc: 'enc' }]);
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const progress = vi.fn();
    await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true }, progress);

    const thumbCalls = progress.mock.calls.filter(([p]) => p.phase === 'thumbnails');
    expect(thumbCalls).toHaveLength(3);
    expect(thumbCalls[thumbCalls.length - 1][0]).toMatchObject({ current: 3, total: 3 });
  });

  it('concurrency is bounded by thumbnailConcurrency option', async () => {
    // 45 thumbnails spans several batches — with fewer than one batch's worth
    // there is only ever one request in flight and the bound is untested.
    const bookmarks = Array.from({ length: 45 }, (_, i) =>
      makeBookmark({ id: `bm-${i}`, thumbnailFileId: `img-${i}` }),
    );
    vi.mocked(getBookmarks).mockResolvedValueOnce(bookmarks);

    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(apiFetch).mockImplementation(async (path) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 10));
      inFlight--;
      return idsFromBatchPath(path as string).map((id) => ({ id, data_enc: `enc-${id}` }));
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await exportBookmarks(
      FAKE_KEY,
      { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailConcurrency: 2 },
    );

    expect(maxInFlight).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Batched fetching + transient-failure handling
//
// Regression cover for the silent thumbnail loss: one request per thumbnail
// overran nginx's api_read limit_req zone (rate=60r/m burst=20), and every
// resulting 429 was swallowed into `thumbnail: null` under the skip policy.
// ---------------------------------------------------------------------------

/** Extract the id list from a PostgREST `id=in.(a,b,c)` query path. */
function idsFromBatchPath(path: string): string[] {
  const m = path.match(/id=in\.\(([^)]*)\)/);
  if (!m) throw new Error(`expected a batched id=in.() request, got: ${path}`);
  return m[1].split(',').filter(Boolean);
}

/** Build a batch response carrying one row per requested id. */
function batchRows(path: string): { id: string; data_enc: string }[] {
  return idsFromBatchPath(path).map((id) => ({ id, data_enc: `enc-${id}` }));
}

function makeThumbBookmarks(count: number): Bookmark[] {
  return Array.from({ length: count }, (_, i) =>
    makeBookmark({ id: `bm-${i}`, thumbnailFileId: `img-${i}`, thumbnailOriginalName: `p${i}.jpg` }),
  );
}

const FAST_RETRY: Partial<ExportOptions> = { thumbnailRetryBaseMs: 1 };

describe('exportBookmarks — batched thumbnail fetching', () => {
  it('fetches 23 thumbnails in a handful of batched requests rather than one each', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(23));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    // 23 single-row requests is what exhausted the nginx budget. A batched
    // export must stay far below that.
    expect(vi.mocked(apiFetch).mock.calls.length).toBeLessThanOrEqual(4);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('id=in.(');
  });

  it('embeds every one of 23 thumbnails when fetched in batches', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(23));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const result = await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    const embedded = result.bookmarks.filter((b) => b.thumbnail?.type === 'data');
    expect(embedded).toHaveLength(23);
  });

  it('requests id and data_enc so rows can be matched back to their bookmark', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(2));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    const path = vi.mocked(apiFetch).mock.calls[0][0] as string;
    expect(path).toMatch(/select=(id,data_enc|data_enc,id)/);
  });

  it('maps each batched row to the right bookmark', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(3));
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      // Return rows in reverse order to prove mapping is by id, not by position.
      return batchRows(path as string).reverse();
    });
    vi.mocked(decryptBinary).mockImplementation(async (_key, enc) =>
      // Encode the row identity into the bytes so we can assert the pairing.
      new Uint8Array([0xff, 0xd8, 0xff, (enc as string).charCodeAt((enc as string).length - 1)]),
    );

    const result = await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    // bm-0 must carry the bytes derived from enc-img-0, i.e. last char '0'.
    const thumb0 = result.bookmarks.find((b) => b.title === 'Test Bookmark' && b.thumbnail?.type === 'data');
    expect(thumb0).toBeDefined();
    const expected = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, '0'.charCodeAt(0)))}`;
    const first = result.bookmarks[0].thumbnail;
    expect(first?.type).toBe('data');
    if (first?.type === 'data') expect(first.value).toBe(expected);
  });

  it('skips only the offending row when one thumbnail in a batch fails to decrypt', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(3));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockImplementation(async (_key, enc) => {
      if ((enc as string) === 'enc-img-1') throw new Error('decrypt failed');
      return JPEG_BYTES;
    });

    const result = await exportBookmarks(FAKE_KEY, {
      ...DEFAULT_OPTIONS,
      includeThumbnails: true,
      thumbnailErrorPolicy: 'skip',
    });

    expect(result.bookmarks[0].thumbnail?.type).toBe('data');
    expect(result.bookmarks[1].thumbnail).toBeNull();
    expect(result.bookmarks[2].thumbnail?.type).toBe('data');
  });

  it('skips only the missing row when a batch response omits an id', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(3));
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      batchRows(path as string).filter((r) => r.id !== 'img-1'),
    );
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const result = await exportBookmarks(FAKE_KEY, {
      ...DEFAULT_OPTIONS,
      includeThumbnails: true,
      thumbnailErrorPolicy: 'skip',
    });

    expect(result.bookmarks[0].thumbnail?.type).toBe('data');
    expect(result.bookmarks[1].thumbnail).toBeNull();
    expect(result.bookmarks[2].thumbnail?.type).toBe('data');
  });
});

describe('exportBookmarks — transient failure handling', () => {
  it('retries a rate-limited batch and still embeds its thumbnails', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(2));
    let attempts = 0;
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      attempts++;
      if (attempts === 1) throw new ApiError(429, 'Too many requests. Please wait a moment and try again.');
      return batchRows(path as string);
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const result = await exportBookmarks(FAKE_KEY, {
      ...DEFAULT_OPTIONS,
      ...FAST_RETRY,
      includeThumbnails: true,
    });

    expect(attempts).toBe(2);
    expect(result.bookmarks.filter((b) => b.thumbnail?.type === 'data')).toHaveLength(2);
  });

  it('retries a 5xx batch and still embeds its thumbnails', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(1));
    let attempts = 0;
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      attempts++;
      if (attempts === 1) throw new ApiError(503, 'The service is temporarily unavailable.');
      return batchRows(path as string);
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const result = await exportBookmarks(FAKE_KEY, {
      ...DEFAULT_OPTIONS,
      ...FAST_RETRY,
      includeThumbnails: true,
    });

    expect(attempts).toBe(2);
    expect(result.bookmarks[0].thumbnail?.type).toBe('data');
  });

  it('fails the export instead of silently dropping thumbnails when rate limiting persists', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(5));
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(429, 'Too many requests.'));
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    // The reported bug: under the skip policy this resolved with thumbnail:null
    // and the UI reported success. A retryable failure must now be fatal.
    await expect(
      exportBookmarks(FAKE_KEY, {
        ...DEFAULT_OPTIONS,
        ...FAST_RETRY,
        includeThumbnails: true,
        thumbnailErrorPolicy: 'skip',
      }),
    ).rejects.toThrow(/thumbnail/i);
  });

  it('does not retry a permanently unusable row', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(1));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockResolvedValue(NON_JPEG_BYTES);

    const result = await exportBookmarks(FAKE_KEY, {
      ...DEFAULT_OPTIONS,
      ...FAST_RETRY,
      includeThumbnails: true,
      thumbnailErrorPolicy: 'skip',
    });

    expect(result.bookmarks[0].thumbnail).toBeNull();
    // A corrupt payload will never become valid — retrying it just burns budget.
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('reports the number of permanently skipped thumbnails through progress', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(3));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockImplementation(async (_key, enc) =>
      (enc as string) === 'enc-img-1' ? NON_JPEG_BYTES : JPEG_BYTES,
    );

    const progress = vi.fn();
    await exportBookmarks(
      FAKE_KEY,
      { ...DEFAULT_OPTIONS, ...FAST_RETRY, includeThumbnails: true, thumbnailErrorPolicy: 'skip' },
      progress,
    );

    const thumbEvents = progress.mock.calls
      .map(([p]) => p as { phase: string; skipped?: number })
      .filter((p) => p.phase === 'thumbnails');
    expect(thumbEvents.at(-1)?.skipped).toBe(1);
  });

  it('reports zero skipped thumbnails when every thumbnail succeeds', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(3));
    vi.mocked(apiFetch).mockImplementation(async (path) => batchRows(path as string));
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const progress = vi.fn();
    await exportBookmarks(
      FAKE_KEY,
      { ...DEFAULT_OPTIONS, ...FAST_RETRY, includeThumbnails: true },
      progress,
    );

    const thumbEvents = progress.mock.calls
      .map(([p]) => p as { phase: string; skipped?: number })
      .filter((p) => p.phase === 'thumbnails');
    expect(thumbEvents.at(-1)?.skipped).toBe(0);
  });

  it('aborts promptly while waiting to retry a rate-limited batch', async () => {
    const ctrl = new AbortController();
    vi.mocked(getBookmarks).mockResolvedValueOnce(makeThumbBookmarks(2));
    vi.mocked(apiFetch).mockImplementation(async () => {
      ctrl.abort();
      throw new ApiError(429, 'Too many requests.');
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await expect(
      exportBookmarks(
        FAKE_KEY,
        // Long backoff: the only way this resolves quickly is if the abort
        // interrupts the wait rather than sleeping through it.
        { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailRetryBaseMs: 60_000 },
        undefined,
        ctrl.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe('exportBookmarks — output shape', () => {
  it('output has version 1 and a valid ISO exportedAt timestamp', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce([]);
    const result = await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS);

    expect(result.version).toBe(1);
    expect(() => new Date(result.exportedAt)).not.toThrow();
  });

  it('totalBookmarks matches bookmarks array length', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce([makeBookmark(), makeBookmark()]);
    const result = await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS);

    expect(result.totalBookmarks).toBe(result.bookmarks.length);
  });

  it('resolves tag IDs to names; falls back to ID for unknown tags', async () => {
    const bm = makeBookmark({ tagIds: ['tag-1', 'tag-unknown'] });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);
    vi.mocked(getTags).mockResolvedValueOnce([{ id: 'tag-1', name: 'reading' }]);

    const result = await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS);

    expect(result.bookmarks[0].tags).toEqual(['reading', 'tag-unknown']);
  });

  it('thumbnail is null when both thumbnailUrl and thumbnailFileId are null', async () => {
    const bm = makeBookmark({ thumbnailUrl: null, thumbnailFileId: null });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm]);

    const result = await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS);

    expect(result.bookmarks[0].thumbnail).toBeNull();
  });

  it('does not throw when onProgress is omitted', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce([]);
    await expect(exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

describe('exportBookmarks — progress', () => {
  it('emits tags phase progress', async () => {
    vi.mocked(getBookmarks).mockResolvedValueOnce([]);
    vi.mocked(getTags).mockResolvedValueOnce([{ id: 't1', name: 'work' }]);

    const progress = vi.fn();
    await exportBookmarks(FAKE_KEY, DEFAULT_OPTIONS, progress);

    const tagCalls = progress.mock.calls.filter(([p]) => p.phase === 'tags');
    expect(tagCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// exportToCsv
// ---------------------------------------------------------------------------

describe('exportToCsv', () => {
  it('is synchronous and returns a string', () => {
    const data = makeExportData();
    const result = exportToCsv(data);
    expect(typeof result).toBe('string');
  });

  it('includes a header row', () => {
    const data = makeExportData();
    const csv = exportToCsv(data);
    expect(csv).toMatch(/^title,url,tags/);
  });

  it('produces one data row per bookmark', () => {
    const data = makeExportData({
      totalBookmarks: 2,
      bookmarks: [
        { title: 'A', url: 'https://a.com', tags: [], thumbnail: null, createdAt: '', updatedAt: '' },
        { title: 'B', url: 'https://b.com', tags: [], thumbnail: null, createdAt: '', updatedAt: '' },
      ],
    });
    const lines = exportToCsv(data).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  it('pipe-separates tags', () => {
    const data = makeExportData({
      totalBookmarks: 1,
      bookmarks: [
        { title: 'T', url: 'https://x.com', tags: ['work', 'reading'], thumbnail: null, createdAt: '', updatedAt: '' },
      ],
    });
    expect(exportToCsv(data)).toContain('work|reading');
  });

  it('prefixes formula-injection characters with a single quote (M-08)', () => {
    const data = makeExportData({
      totalBookmarks: 1,
      bookmarks: [
        { title: '=SUM(1+1)', url: 'https://x.com', tags: [], thumbnail: null, createdAt: '', updatedAt: '' },
      ],
    });
    // Single-quote prefix is more robust than \t — Excel/Calc both
    // honour ' as a literal-text marker without evaluating the cell.
    expect(exportToCsv(data)).toContain("'=SUM(1+1)");
  });

  it('also prevents injection for +, -, @ prefixes', () => {
    for (const prefix of ['+', '-', '@']) {
      const data = makeExportData({
        totalBookmarks: 1,
        bookmarks: [
          { title: `${prefix}cmd`, url: 'https://x.com', tags: [], thumbnail: null, createdAt: '', updatedAt: '' },
        ],
      });
      expect(exportToCsv(data)).toContain(`'${prefix}cmd`);
    }
  });

  it('does NOT prefix titles that just happen to start with a literal apostrophe', () => {
    const data = makeExportData({
      totalBookmarks: 1,
      bookmarks: [
        { title: "'Twas the night", url: 'https://x.com', tags: [], thumbnail: null, createdAt: '', updatedAt: '' },
      ],
    });
    // Existing apostrophes pass through unchanged; we only add a NEW '
    // when the first char is a formula trigger.
    expect(exportToCsv(data)).toContain("\"'Twas the night\"");
    expect(exportToCsv(data)).not.toContain("''Twas");
  });

  it('includes direct URL thumbnails in the thumbnailUrl column', () => {
    const data = makeExportData({
      totalBookmarks: 1,
      bookmarks: [
        {
          title: 'T', url: 'https://x.com', tags: [],
          thumbnail: { type: 'url', value: 'https://img.example.com/pic.jpg' },
          createdAt: '', updatedAt: '',
        },
      ],
    });
    expect(exportToCsv(data)).toContain('https://img.example.com/pic.jpg');
  });

  it('produces an empty thumbnailUrl cell for data-URI thumbnails', () => {
    const data = makeExportData({
      totalBookmarks: 1,
      bookmarks: [
        {
          title: 'T', url: 'https://x.com', tags: [],
          thumbnail: { type: 'data', value: 'data:image/jpeg;base64,abc', originalName: 'f.jpg' },
          createdAt: '', updatedAt: '',
        },
      ],
    });
    const csv = exportToCsv(data);
    // thumbnailUrl column should be empty (just empty quotes)
    expect(csv).toContain('""');
  });

  it('escapes internal double quotes per RFC 4180', () => {
    const data = makeExportData({
      totalBookmarks: 1,
      bookmarks: [
        {
          title: 'My "favourite" link', url: 'https://x.com', tags: [],
          thumbnail: null, createdAt: '', updatedAt: '',
        },
      ],
    });
    expect(exportToCsv(data)).toContain('"My ""favourite"" link"');
  });
});

// ---------------------------------------------------------------------------
// triggerDownload
// ---------------------------------------------------------------------------

describe('triggerDownload', () => {
  it('creates an object URL and revokes it after click', () => {
    const fakeUrl = 'blob:fake-url';
    const createMock = vi.fn().mockReturnValue(fakeUrl);
    const revokeMock = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createMock, revokeObjectURL: revokeMock });

    const blob = new Blob(['hello'], { type: 'text/plain' });
    triggerDownload(blob, 'test.txt');

    expect(createMock).toHaveBeenCalledWith(blob);
    expect(revokeMock).toHaveBeenCalledWith(fakeUrl);
  });

  it('removes the anchor element from the DOM after click', () => {
    const fakeUrl = 'blob:fake';
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue(fakeUrl),
      revokeObjectURL: vi.fn(),
    });

    const blob = new Blob(['x']);
    triggerDownload(blob, 'file.txt');

    expect(document.querySelector('a[download="file.txt"]')).toBeNull();
  });

  it('still revokes the URL even if click throws', () => {
    const fakeUrl = 'blob:fake';
    const revokeMock = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue(fakeUrl),
      revokeObjectURL: revokeMock,
    });

    // Make click throw
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click failed');
    });

    const blob = new Blob(['x']);
    expect(() => triggerDownload(blob, 'file.txt')).toThrow('click failed');
    expect(revokeMock).toHaveBeenCalledWith(fakeUrl);

    vi.restoreAllMocks();
  });
});
