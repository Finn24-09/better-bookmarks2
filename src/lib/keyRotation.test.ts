import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — hoisted by Vitest before any imports
//
// Only the network and crypto boundaries are stubbed. bookmarks.ts / tags.ts
// run for real so the assertions below check the actual PATCH bodies that
// would reach PostgREST, not mock behaviour.
// ---------------------------------------------------------------------------

vi.mock('./api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./api')>();
  return { ...mod, apiFetch: vi.fn() };
});

vi.mock('./crypto', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./crypto')>();
  return {
    ...mod,
    encrypt: vi.fn(async (_k: CryptoKey, t: string) => `E:${t}`),
    decrypt: vi.fn(async (_k: CryptoKey, c: string) => String(c).replace(/^E:/, '')),
    encryptBinary: vi.fn(async (_k: CryptoKey, b: Uint8Array) => `EB:${b.length}`),
    decryptBinary: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 0x01])),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { apiFetch, ApiError } from './api';
import { reencryptRecords, type RotationInput } from './keyRotation';
import type { Bookmark } from './bookmarks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLD_KEY = {} as CryptoKey;
const NEW_KEY = {} as CryptoKey;

function makeBookmark(i: number, thumb = false): Bookmark {
  return {
    id: `bm-${i}`,
    title: `Title ${i}`,
    url: `https://example.com/${i}`,
    thumbnailUrl: null,
    thumbnailFileId: thumb ? `img-${i}` : null,
    thumbnailOriginalName: thumb ? `p${i}.jpg` : null,
    tagIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    keyVersion: 1,
    thumbnailKeyVersion: thumb ? 1 : null,
  };
}

function baseInput(overrides: Partial<RotationInput> = {}): RotationInput {
  return {
    bookmarks: [],
    thumbnailImageIds: [],
    tags: [],
    oldKey: OLD_KEY,
    newKey: NEW_KEY,
    targetVersion: 2,
    retryBaseMs: 1,
    ...overrides,
  };
}

/** All apiFetch calls that were writes (PATCH), as [path, parsedBody] pairs. */
function writes(): Array<[string, Record<string, unknown>]> {
  return vi
    .mocked(apiFetch)
    .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([path, init]) => [
      path as string,
      JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
    ]);
}

/** Respond to a batched thumbnail read with one row per requested id. */
function thumbnailBatchResponse(path: string) {
  const m = path.match(/id=in\.\(([^)]*)\)/);
  if (!m) throw new Error(`expected batched id=in.() read, got: ${path}`);
  return m[1]
    .split(',')
    .filter(Boolean)
    .map((id) => ({ id, data_enc: `E:data-${id}`, original_name_enc: `E:name-${id}` }));
}

/** Default happy-path transport: batched reads succeed, every PATCH succeeds. */
function mockTransport(onWrite?: (path: string) => void) {
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    const p = path as string;
    if ((init as RequestInit | undefined)?.method === 'PATCH') {
      onWrite?.(p);
      return undefined as never;
    }
    return thumbnailBatchResponse(p) as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// The reported failure: a rate-limited thumbnail read stranded every bookmark
//
// The old flow PATCHed all bookmarks (re-encrypting them with newKey and
// stamping targetVersion) *before* it read the thumbnail rows. A 429 on the
// read then aborted the rotation with change_password never called — leaving
// every bookmark encrypted under a key the user's password no longer derives.
// ---------------------------------------------------------------------------

describe('reencryptRecords — no writes before every read succeeds', () => {
  it('issues no writes at all when the thumbnail read is rate-limited', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(429, 'Too many requests.'));

    await expect(
      reencryptRecords(
        baseInput({
          bookmarks: [makeBookmark(0, true), makeBookmark(1, true)],
          thumbnailImageIds: ['img-0', 'img-1'],
          tags: [{ id: 'tag-0', name: 'reading' }],
        }),
      ),
    ).rejects.toThrow();

    expect(writes()).toHaveLength(0);
  });

  it('issues no writes when a thumbnail row is missing from the read', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if ((init as RequestInit | undefined)?.method === 'PATCH') return undefined as never;
      // img-1 silently absent — its ciphertext can never be re-encrypted, so
      // committing the rest would strand it at the old key version.
      return thumbnailBatchResponse(path as string).filter((r) => r.id !== 'img-1') as never;
    });

    await expect(
      reencryptRecords(
        baseInput({
          bookmarks: [makeBookmark(0, true), makeBookmark(1, true)],
          thumbnailImageIds: ['img-0', 'img-1'],
        }),
      ),
    ).rejects.toThrow();

    expect(writes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bounded fan-out
// ---------------------------------------------------------------------------

describe('reencryptRecords — bounded fan-out', () => {
  it('batches thumbnail reads instead of one request per thumbnail', async () => {
    mockTransport();

    const ids = Array.from({ length: 23 }, (_, i) => `img-${i}`);
    await reencryptRecords(baseInput({ thumbnailImageIds: ids }));

    const reads = vi
      .mocked(apiFetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method !== 'PATCH');
    // 23 separate reads is what overran the nginx api_read budget.
    expect(reads.length).toBeLessThanOrEqual(4);
    expect(reads[0][0]).toContain('id=in.(');
  });

  it('never exceeds the write concurrency bound', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if ((init as RequestInit | undefined)?.method !== 'PATCH') {
        return thumbnailBatchResponse(path as string) as never;
      }
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 5));
      inFlight--;
      return undefined as never;
    });

    await reencryptRecords(
      baseInput({
        bookmarks: Array.from({ length: 30 }, (_, i) => makeBookmark(i)),
        tags: Array.from({ length: 15 }, (_, i) => ({ id: `tag-${i}`, name: `t${i}` })),
      }),
    );

    // The old code fired all 45 simultaneously via Promise.all.
    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Transient failures
// ---------------------------------------------------------------------------

describe('reencryptRecords — transient failures', () => {
  it('retries a rate-limited thumbnail write and completes the rotation', async () => {
    let rejected = false;
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      const p = path as string;
      if ((init as RequestInit | undefined)?.method !== 'PATCH') {
        return thumbnailBatchResponse(p) as never;
      }
      if (!rejected && p.includes('thumbnail_images')) {
        rejected = true;
        throw new ApiError(429, 'Too many requests.');
      }
      return undefined as never;
    });

    await expect(
      reencryptRecords(
        baseInput({ bookmarks: [makeBookmark(0, true)], thumbnailImageIds: ['img-0'] }),
      ),
    ).resolves.toBeUndefined();

    expect(rejected).toBe(true);
    expect(writes().some(([p]) => p.includes('thumbnail_images'))).toBe(true);
  });

  it('rejects when a write keeps failing after its retries', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      const p = path as string;
      if ((init as RequestInit | undefined)?.method !== 'PATCH') {
        return thumbnailBatchResponse(p) as never;
      }
      throw new ApiError(429, 'Too many requests.');
    });

    await expect(
      reencryptRecords(
        baseInput({ bookmarks: [makeBookmark(0, true)], thumbnailImageIds: ['img-0'] }),
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// key_version stamping — the rotation commit contract
// ---------------------------------------------------------------------------

describe('reencryptRecords — key_version stamping', () => {
  it('stamps targetVersion on bookmark, thumbnail, and tag writes', async () => {
    mockTransport();

    await reencryptRecords(
      baseInput({
        bookmarks: [makeBookmark(0, true)],
        thumbnailImageIds: ['img-0'],
        tags: [{ id: 'tag-0', name: 'reading' }],
        targetVersion: 7,
      }),
    );

    const byTable = (frag: string) => writes().filter(([p]) => p.includes(frag));
    expect(byTable('/bookmarks?')).toHaveLength(1);
    expect(byTable('/thumbnail_images?')).toHaveLength(1);
    expect(byTable('/tags?')).toHaveLength(1);
    for (const [, body] of writes()) {
      expect(body.key_version).toBe(7);
    }
  });

  it('re-encrypts thumbnail data and original name with the new key', async () => {
    mockTransport();

    await reencryptRecords(baseInput({ thumbnailImageIds: ['img-0'] }));

    const [[path, body]] = writes();
    expect(path).toContain('/thumbnail_images?id=eq.img-0');
    // decryptBinary stub yields 4 bytes; encryptBinary stub encodes the length.
    expect(body.data_enc).toBe('EB:4');
    expect(body.original_name_enc).toBe('E:name-img-0');
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('reencryptRecords — cancellation', () => {
  it('rejects with AbortError and stops writing when cancelled mid-rotation', async () => {
    const ctrl = new AbortController();
    let writeCount = 0;
    mockTransport(() => {
      writeCount++;
      if (writeCount === 1) ctrl.abort();
    });

    await expect(
      reencryptRecords(
        baseInput({
          bookmarks: Array.from({ length: 20 }, (_, i) => makeBookmark(i)),
          signal: ctrl.signal,
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(writeCount).toBeLessThan(20);
  });
});
