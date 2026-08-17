import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveKey } from './crypto';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from './api';

// Clear all mock state before every test so calls don't bleed between suites.
beforeEach(() => {
  vi.clearAllMocks();
});
import {
  compressImage,
  uploadThumbnail,
  uploadThumbnailFromBytes,
  fetchThumbnailObjectUrl,
  deleteThumbnailImage,
  reencryptThumbnailBatchToBodies,
  writeReencryptedThumbnail,
} from './thumbnails';

// ---------------------------------------------------------------------------
// compressImage
// ---------------------------------------------------------------------------

describe('compressImage', () => {
  beforeEach(() => {
    // jsdom's Canvas is a stub; mock toBlob to return a small fake JPEG blob.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, callback, type, _quality) {
        // Return a tiny fake blob that represents the compressed image
        callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: type ?? 'image/jpeg' }));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a Blob', async () => {
    const file = new File([new Uint8Array(100)], 'test.jpg', { type: 'image/jpeg' });

    // Mock Image load
    const originalImage = globalThis.Image;
    (globalThis as unknown as Record<string, unknown>).Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 800;
      height = 600;
      set src(_: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    };

    const result = await compressImage(file);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/jpeg');

    (globalThis as unknown as Record<string, unknown>).Image = originalImage;
  });

  it('constrains dimensions to max 480×270', async () => {
    let capturedWidth = 0;
    let capturedHeight = 0;

    const canvasStub = {
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: BlobCallback) =>
        cb(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
      get width() { return capturedWidth; },
      set width(v) { capturedWidth = v; },
      get height() { return capturedHeight; },
      set height(v) { capturedHeight = v; },
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') return canvasStub as unknown as HTMLElement;
      return document.createElement(tag);
    });

    const originalImage = globalThis.Image;
    (globalThis as unknown as Record<string, unknown>).Image = class {
      onload: (() => void) | null = null;
      width = 1920;
      height = 1080;
      set src(_: string) { setTimeout(() => this.onload?.(), 0); }
    };

    const file = new File([new Uint8Array(10)], 'large.jpg', { type: 'image/jpeg' });
    await compressImage(file);

    // 1920×1080 scaled to fit 480×270 → ratio = 270/1080 = 0.25 → 480×270
    expect(capturedWidth).toBe(480);
    expect(capturedHeight).toBe(270);

    (globalThis as unknown as Record<string, unknown>).Image = originalImage;
    vi.restoreAllMocks();
  });

  it('does not upscale images smaller than the max dimensions', async () => {
    let capturedWidth = 0;
    let capturedHeight = 0;

    const canvasStub = {
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: BlobCallback) =>
        cb(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
      get width() { return capturedWidth; },
      set width(v) { capturedWidth = v; },
      get height() { return capturedHeight; },
      set height(v) { capturedHeight = v; },
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') return canvasStub as unknown as HTMLElement;
      return document.createElement(tag);
    });

    const originalImage = globalThis.Image;
    (globalThis as unknown as Record<string, unknown>).Image = class {
      onload: (() => void) | null = null;
      width = 200;
      height = 100;
      set src(_: string) { setTimeout(() => this.onload?.(), 0); }
    };

    const file = new File([new Uint8Array(10)], 'small.jpg', { type: 'image/jpeg' });
    await compressImage(file);

    // 200×100 is already smaller than 480×270 → no upscaling
    expect(capturedWidth).toBe(200);
    expect(capturedHeight).toBe(100);

    (globalThis as unknown as Record<string, unknown>).Image = originalImage;
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// uploadThumbnail
// ---------------------------------------------------------------------------

describe('uploadThumbnail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls apiFetch POST /thumbnail_images and returns the image id', async () => {
    vi.mocked(apiFetch).mockResolvedValue([{ id: 'img-uuid-1' }]);

    const key = await deriveKey('pass', 'user@example.com');

    // Bypass compressImage by mocking it at a higher level:
    // provide a minimal File whose blob reads as a small Uint8Array.
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (cb: BlobCallback) {
        cb(new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }));
      },
    );
    const originalImage = globalThis.Image;
    (globalThis as unknown as Record<string, unknown>).Image = class {
      onload: (() => void) | null = null;
      width = 100; height = 100;
      set src(_: string) { setTimeout(() => this.onload?.(), 0); }
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
    );

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const id = await uploadThumbnail(file, key, 'user-1');

    expect(id).toBe('img-uuid-1');
    expect(apiFetch).toHaveBeenCalledWith(
      '/thumbnail_images',
      expect.objectContaining({ method: 'POST' }),
    );

    const callBody = JSON.parse(
      (vi.mocked(apiFetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(callBody.user_id).toBe('user-1');
    expect(typeof callBody.data_enc).toBe('string');
    expect(typeof callBody.original_name_enc).toBe('string');

    (globalThis as unknown as Record<string, unknown>).Image = originalImage;
  });
});

// ---------------------------------------------------------------------------
// fetchThumbnailObjectUrl
// ---------------------------------------------------------------------------

describe('fetchThumbnailObjectUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches data_enc, decrypts it, and returns an object URL', async () => {
    const key = await deriveKey('pass', 'user@example.com');

    // Build a real encrypted payload so decryptBinary works
    const { encryptBinary } = await import('./crypto');
    const fakeBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const dataEnc = await encryptBinary(key, fakeBytes);

    vi.mocked(apiFetch).mockResolvedValue([{ data_enc: dataEnc }]);

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:fake-url');

    const url = await fetchThumbnailObjectUrl('img-1', key);

    expect(url).toBe('blob:fake-url');
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/thumbnail_images?id=eq.img-1'),
    );

    URL.createObjectURL = originalCreateObjectURL;
  });
});

// ---------------------------------------------------------------------------
// deleteThumbnailImage
// ---------------------------------------------------------------------------

describe('deleteThumbnailImage', () => {
  it('calls apiFetch DELETE with the image id in the query string', async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await deleteThumbnailImage('img-abc-123');

    expect(apiFetch).toHaveBeenCalledWith(
      '/thumbnail_images?id=eq.img-abc-123',
      { method: 'DELETE' },
    );
  });
});

// ---------------------------------------------------------------------------
// reencryptThumbnailBatchToBodies / writeReencryptedThumbnail
// ---------------------------------------------------------------------------

describe('reencryptThumbnailBatchToBodies', () => {
  it('reads every id in one batched request and returns bodies for the new key', async () => {
    const { deriveKey: dk, encryptBinary: eb, encrypt: enc, decrypt: dec, decryptBinary: deb } =
      await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    const bytesA = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const bytesB = new Uint8Array([0x11, 0x22]);
    const [encA, nameA, encB, nameB] = await Promise.all([
      eb(oldKey, bytesA),
      enc(oldKey, 'a.jpg'),
      eb(oldKey, bytesB),
      enc(oldKey, 'b.jpg'),
    ]);

    vi.mocked(apiFetch).mockResolvedValueOnce([
      // Reverse order proves rows are matched to ids by id, not by position.
      { id: 'img-b', data_enc: encB, original_name_enc: nameB },
      { id: 'img-a', data_enc: encA, original_name_enc: nameA },
    ]);

    const bodies = await reencryptThumbnailBatchToBodies(['img-a', 'img-b'], oldKey, newKey);

    // One request for both ids — a request per thumbnail is what overran the
    // nginx api_read budget during key rotation.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toContain('id=in.(img-a,img-b)');

    const byId = new Map(bodies.map((b) => [b.imageId, b]));
    const [decA, decNameA] = await Promise.all([
      deb(newKey, byId.get('img-a')!.data_enc),
      dec(newKey, byId.get('img-a')!.original_name_enc),
    ]);
    expect(Array.from(decA)).toEqual(Array.from(bytesA));
    expect(decNameA).toBe('a.jpg');
  });

  it('makes no PATCH — it only prepares bodies', async () => {
    const { deriveKey: dk, encryptBinary: eb, encrypt: enc } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    vi.mocked(apiFetch).mockResolvedValueOnce([
      {
        id: 'img-a',
        data_enc: await eb(oldKey, new Uint8Array([1, 2])),
        original_name_enc: await enc(oldKey, 'a.jpg'),
      },
    ]);

    await reencryptThumbnailBatchToBodies(['img-a'], oldKey, newKey);

    const patches = vi
      .mocked(apiFetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patches).toHaveLength(0);
  });

  it('throws rather than returning empty ciphertext when a row is missing', async () => {
    const { deriveKey: dk } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    vi.mocked(apiFetch).mockResolvedValueOnce([]);

    // Returning empty strings here used to be the contract, and the caller
    // PATCHed them straight back — so a response that yielded no rows for a
    // row that does exist would overwrite live thumbnail data with ''.
    await expect(
      reencryptThumbnailBatchToBodies(['img-gone'], oldKey, newKey),
    ).rejects.toThrow(/img-gone/);
  });

  it('throws when apiFetch yields undefined instead of an array', async () => {
    const { deriveKey: dk } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    // apiFetch returns undefined when a 200 body fails to parse as JSON.
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);

    await expect(
      reencryptThumbnailBatchToBodies(['img-a'], oldKey, newKey),
    ).rejects.toThrow(/img-a/);
  });

  it('resolves to an empty list without any request when given no ids', async () => {
    const { deriveKey: dk } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    await expect(reencryptThumbnailBatchToBodies([], oldKey, newKey)).resolves.toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('writeReencryptedThumbnail', () => {
  it('PATCHes the row with the new ciphertext and the target key version', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);

    await writeReencryptedThumbnail(
      { imageId: 'img-a', data_enc: 'newdata', original_name_enc: 'newname' },
      7,
    );

    expect(apiFetch).toHaveBeenCalledWith(
      '/thumbnail_images?id=eq.img-a',
      expect.objectContaining({ method: 'PATCH' }),
    );
    const init = vi.mocked(apiFetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      data_enc: 'newdata',
      original_name_enc: 'newname',
      key_version: 7,
    });
  });
});

// ---------------------------------------------------------------------------
// uploadThumbnailFromBytes — request body
//
// key_version is rotation-integrity state, not user data: the DB stamps it
// from the caller's verified JWT (docker/db/init/13_key_version_stamp.sql).
// uploadThumbnailFromBytes is used here rather than uploadThumbnail because it
// skips compression and so needs no Canvas/Image stubbing; both build the same
// POST body.
// ---------------------------------------------------------------------------

describe('uploadThumbnailFromBytes', () => {
  it('does NOT send key_version — the server stamps it (#135)', async () => {
    vi.mocked(apiFetch).mockResolvedValue([{ id: 'img-uuid-1' }]);
    const key = await deriveKey('pass', 'user@example.com');

    await uploadThumbnailFromBytes(new Uint8Array([0xff, 0xd8]), 'photo.jpg', key, 'user-uuid-123');

    const body = JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string);
    expect(body.key_version).toBeUndefined();
    expect(body.user_id).toBe('user-uuid-123');
  });
});
