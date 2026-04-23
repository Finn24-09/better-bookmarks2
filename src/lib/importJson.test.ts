import { describe, it, expect } from 'vitest';
import { validateJsonFile, parseJsonExport, JsonImportError } from './importJson';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, size: number): File {
  const content = 'x'.repeat(size);
  return new File([content], name, { type: 'application/json' });
}

/** Minimal valid JPEG: SOI + APP0 marker header bytes */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const validJpegBase64 = btoa(String.fromCharCode(...JPEG_BYTES));
const validDataUri = `data:image/jpeg;base64,${validJpegBase64}`;

function makeExport(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    totalBookmarks: 1,
    bookmarks: [
      { title: 'Example', url: 'https://example.com', tags: [], thumbnail: null },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// validateJsonFile
// ---------------------------------------------------------------------------

describe('validateJsonFile', () => {
  it('accepts a .json file within size limit', () => {
    expect(() => validateJsonFile(makeFile('export.json', 100))).not.toThrow();
  });

  it('rejects a non-.json extension', () => {
    expect(() => validateJsonFile(makeFile('export.txt', 100))).toThrow(JsonImportError);
    expect(() => validateJsonFile(makeFile('export.txt', 100))).toThrow(/\.json/);
  });

  it('rejects a file exceeding 100 MB', () => {
    const oversized = makeFile('export.json', 100 * 1024 * 1024 + 1);
    expect(() => validateJsonFile(oversized)).toThrow(JsonImportError);
    expect(() => validateJsonFile(oversized)).toThrow(/too large/i);
  });
});

// ---------------------------------------------------------------------------
// parseJsonExport — structural validation
// ---------------------------------------------------------------------------

describe('parseJsonExport — structural validation', () => {
  it('rejects invalid JSON text', () => {
    expect(() => parseJsonExport('not json {')).toThrow(JsonImportError);
    expect(() => parseJsonExport('not json {')).toThrow(/not valid json/i);
  });

  it('rejects a JSON array at top level', () => {
    expect(() => parseJsonExport('[]')).toThrow(JsonImportError);
  });

  it('rejects missing or wrong version', () => {
    expect(() => parseJsonExport(makeExport({ version: 2 }))).toThrow(JsonImportError);
    expect(() => parseJsonExport(makeExport({ version: 2 }))).toThrow(/version/i);
    expect(() => parseJsonExport(makeExport({ version: undefined }))).toThrow(JsonImportError);
  });

  it('rejects missing bookmarks array', () => {
    expect(() => parseJsonExport(makeExport({ bookmarks: 'nope' }))).toThrow(JsonImportError);
    expect(() => parseJsonExport(makeExport({ bookmarks: 'nope' }))).toThrow(/bookmarks/i);
  });

  it('rejects an empty bookmarks array', () => {
    expect(() => parseJsonExport(makeExport({ bookmarks: [] }))).toThrow(JsonImportError);
    expect(() => parseJsonExport(makeExport({ bookmarks: [] }))).toThrow(/no bookmarks/i);
  });

  it('rejects bookmarks array exceeding the maximum', () => {
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({
      title: `B${i}`,
      url: 'https://example.com',
      tags: [],
      thumbnail: null,
    }));
    expect(() => parseJsonExport(makeExport({ bookmarks: tooMany }))).toThrow(JsonImportError);
    expect(() => parseJsonExport(makeExport({ bookmarks: tooMany }))).toThrow(/too many/i);
  });
});

// ---------------------------------------------------------------------------
// parseJsonExport — bookmark-level validation
// ---------------------------------------------------------------------------

describe('parseJsonExport — bookmark validation', () => {
  it('returns a valid bookmark with all fields', () => {
    const result = parseJsonExport(makeExport());
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      title: 'Example',
      url: 'https://example.com',
      tags: [],
      thumbnailUrl: null,
      thumbnailData: null,
    });
    expect(result.skipped).toHaveLength(0);
  });

  it('skips a bookmark with a missing or empty title', () => {
    const bm = (title: unknown) => ({ title, url: 'https://example.com', tags: [], thumbnail: null });
    const result1 = parseJsonExport(makeExport({ bookmarks: [bm('')] }));
    expect(result1.valid).toHaveLength(0);
    expect(result1.skipped[0].reason).toMatch(/title/i);

    const result2 = parseJsonExport(makeExport({ bookmarks: [bm(42)] }));
    expect(result2.valid).toHaveLength(0);
  });

  it('skips a bookmark with an invalid URL', () => {
    const bm = (url: unknown) => ({ title: 'T', url, tags: [], thumbnail: null });
    const result1 = parseJsonExport(makeExport({ bookmarks: [bm('ftp://bad')] }));
    expect(result1.valid).toHaveLength(0);
    expect(result1.skipped[0].reason).toMatch(/url/i);

    const result2 = parseJsonExport(makeExport({ bookmarks: [bm('not a url')] }));
    expect(result2.valid).toHaveLength(0);
  });

  it('accepts http:// and https:// URLs', () => {
    const bms = [
      { title: 'A', url: 'http://example.com', tags: [], thumbnail: null },
      { title: 'B', url: 'https://example.com', tags: [], thumbnail: null },
    ];
    const result = parseJsonExport(makeExport({ bookmarks: bms }));
    expect(result.valid).toHaveLength(2);
  });

  it('collects tags as an array of strings, ignoring non-string values', () => {
    const bm = {
      title: 'T',
      url: 'https://example.com',
      tags: ['work', 42, 'reading', null, ''],
      thumbnail: null,
    };
    const result = parseJsonExport(makeExport({ bookmarks: [bm] }));
    expect(result.valid[0].tags).toEqual(['work', 'reading']);
  });

  it('truncates tag names to 100 characters', () => {
    const longTag = 'a'.repeat(150);
    const bm = { title: 'T', url: 'https://example.com', tags: [longTag], thumbnail: null };
    const result = parseJsonExport(makeExport({ bookmarks: [bm] }));
    expect(result.valid[0].tags[0]).toHaveLength(100);
  });

  it('ignores tags beyond the first 50', () => {
    const manyTags = Array.from({ length: 60 }, (_, i) => `tag${i}`);
    const bm = { title: 'T', url: 'https://example.com', tags: manyTags, thumbnail: null };
    const result = parseJsonExport(makeExport({ bookmarks: [bm] }));
    expect(result.valid[0].tags).toHaveLength(50);
  });

  it('produces correct valid + skipped counts for mixed bookmarks', () => {
    const bookmarks = [
      { title: 'Good', url: 'https://good.com', tags: [], thumbnail: null },
      { title: '', url: 'https://bad.com', tags: [], thumbnail: null },
      { title: 'Good2', url: 'https://good2.com', tags: [], thumbnail: null },
      { title: 'Bad URL', url: 'not-a-url', tags: [], thumbnail: null },
    ];
    const result = parseJsonExport(makeExport({ bookmarks }));
    expect(result.valid).toHaveLength(2);
    expect(result.skipped).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseJsonExport — thumbnail handling
// ---------------------------------------------------------------------------

describe('parseJsonExport — thumbnail handling', () => {
  function makeWithThumb(thumbnail: unknown) {
    return makeExport({
      bookmarks: [{ title: 'T', url: 'https://example.com', tags: [], thumbnail }],
    });
  }

  it('passes through a type:url thumbnail as thumbnailUrl', () => {
    const result = parseJsonExport(makeWithThumb({ type: 'url', value: 'https://img.example.com/pic.jpg' }));
    expect(result.valid[0].thumbnailUrl).toBe('https://img.example.com/pic.jpg');
    expect(result.valid[0].thumbnailData).toBeNull();
  });

  it('rejects non-http/https thumbnail URL silently (bookmark still valid)', () => {
    const result = parseJsonExport(makeWithThumb({ type: 'url', value: 'ftp://bad.com/img.jpg' }));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].thumbnailUrl).toBeNull();
  });

  it('decodes a valid JPEG data URI into thumbnailData bytes', () => {
    const result = parseJsonExport(makeWithThumb({ type: 'data', value: validDataUri, originalName: 'thumb.jpg' }));
    expect(result.valid[0].thumbnailData).toBeInstanceOf(Uint8Array);
    expect(result.valid[0].thumbnailData![0]).toBe(0xff);
    expect(result.valid[0].thumbnailData![1]).toBe(0xd8);
    expect(result.valid[0].thumbnailData![2]).toBe(0xff);
    expect(result.valid[0].thumbnailOriginalName).toBe('thumb.jpg');
  });

  it('skips thumbnail silently when prefix is not data:image/jpeg;base64, (bookmark still valid)', () => {
    const badUri = 'data:image/png;base64,iVBORw0KGgo=';
    const result = parseJsonExport(makeWithThumb({ type: 'data', value: badUri, originalName: 'img.png' }));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].thumbnailData).toBeNull();
  });

  it('skips thumbnail with invalid base64 data (bookmark still valid)', () => {
    const badUri = 'data:image/jpeg;base64,!!!not-base64!!!';
    const result = parseJsonExport(makeWithThumb({ type: 'data', value: badUri, originalName: 'img.jpg' }));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].thumbnailData).toBeNull();
  });

  it('skips thumbnail whose decoded bytes do not have JPEG magic bytes', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const pngBase64 = btoa(String.fromCharCode(...pngBytes));
    const pngUri = `data:image/jpeg;base64,${pngBase64}`;
    const result = parseJsonExport(makeWithThumb({ type: 'data', value: pngUri, originalName: 'img.jpg' }));
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].thumbnailData).toBeNull();
  });

  it('uses "thumbnail.jpg" as fallback originalName when not provided', () => {
    const result = parseJsonExport(makeWithThumb({ type: 'data', value: validDataUri }));
    expect(result.valid[0].thumbnailOriginalName).toBe('thumbnail.jpg');
  });

  it('sets thumbnailData to null when thumbnail is null', () => {
    const result = parseJsonExport(makeWithThumb(null));
    expect(result.valid[0].thumbnailData).toBeNull();
    expect(result.valid[0].thumbnailUrl).toBeNull();
  });
});
