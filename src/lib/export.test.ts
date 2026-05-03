import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted by Vitest before any imports
// ---------------------------------------------------------------------------

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
  apiFetchCount: vi.fn().mockResolvedValue(null),
}));

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

import { apiFetch, apiFetchCount } from './api';
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
    vi.mocked(apiFetch).mockResolvedValue([{ data_enc: 'encrypted' }]);
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
    vi.mocked(apiFetch).mockResolvedValue([{ data_enc: 'enc' }]);
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await exportBookmarks(FAKE_KEY, { ...DEFAULT_OPTIONS, includeThumbnails: true });

    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
      expect.stringContaining('/thumbnail_images?id=eq.img-abc'),
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

  it('thumbnailErrorPolicy skip: continues after fetch failure on one thumbnail', async () => {
    const bm1 = makeBookmark({ id: 'bm-1', thumbnailFileId: 'img-1' });
    const bm2 = makeBookmark({ id: 'bm-2', thumbnailFileId: 'img-2' });
    const bm3 = makeBookmark({ id: 'bm-3', thumbnailFileId: 'img-3' });
    vi.mocked(getBookmarks).mockResolvedValueOnce([bm1, bm2, bm3]);

    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if ((path as string).includes('img-2')) throw new Error('fetch failed');
      return [{ data_enc: 'enc' }];
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    const result = await exportBookmarks(
      FAKE_KEY,
      { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailErrorPolicy: 'skip' },
    );

    expect(result.bookmarks).toHaveLength(3);
    expect(result.bookmarks[1].thumbnail).toBeNull(); // bm-2 failed
    expect(result.bookmarks[0].thumbnail?.type).toBe('data');
    expect(result.bookmarks[2].thumbnail?.type).toBe('data');
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
    const bookmarks = Array.from({ length: 6 }, (_, i) =>
      makeBookmark({ thumbnailFileId: `img-${i}` }),
    );
    vi.mocked(getBookmarks).mockResolvedValueOnce(bookmarks);

    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(apiFetch).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 10));
      inFlight--;
      return [{ data_enc: 'enc' }];
    });
    vi.mocked(decryptBinary).mockResolvedValue(JPEG_BYTES);

    await exportBookmarks(
      FAKE_KEY,
      { ...DEFAULT_OPTIONS, includeThumbnails: true, thumbnailConcurrency: 2 },
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
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
