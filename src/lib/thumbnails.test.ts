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
  fetchThumbnailObjectUrl,
  deleteThumbnailImage,
  reencryptThumbnail,
  reencryptThumbnailToBody,
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
      function (this: HTMLCanvasElement, callback, type, quality) {
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
// reencryptThumbnail
// ---------------------------------------------------------------------------

describe('reencryptThumbnail', () => {
  it('decrypts original_name_enc from the server and re-encrypts with the new key', async () => {
    const { deriveKey: dk, encryptBinary: eb, encrypt: enc } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    const fakeBytes = new Uint8Array([0xff, 0xd8, 0x01]);
    const [oldDataEnc, oldNameEnc] = await Promise.all([
      eb(oldKey, fakeBytes),
      enc(oldKey, 'original-photo.jpg'),
    ]);

    vi.mocked(apiFetch)
      .mockResolvedValueOnce([{ data_enc: oldDataEnc, original_name_enc: oldNameEnc }])
      .mockResolvedValueOnce(undefined);

    await reencryptThumbnail('img-1', oldKey, newKey);

    expect(apiFetch).toHaveBeenCalledTimes(2);
    const patchCall = vi.mocked(apiFetch).mock.calls[1];
    expect(patchCall[0]).toContain('/thumbnail_images?id=eq.img-1');
    expect((patchCall[1] as RequestInit).method).toBe('PATCH');

    const patchBody = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(typeof patchBody.data_enc).toBe('string');
    expect(typeof patchBody.original_name_enc).toBe('string');
    // ciphertexts must differ from the old ones (different key)
    expect(patchBody.data_enc).not.toBe(oldDataEnc);
    expect(patchBody.original_name_enc).not.toBe(oldNameEnc);
  });

  it('does nothing when the thumbnail row is not found', async () => {
    const { deriveKey: dk } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    vi.mocked(apiFetch).mockResolvedValueOnce([]);

    await reencryptThumbnail('img-missing', oldKey, newKey);

    // Only the GET was made; no PATCH
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// reencryptThumbnailToBody
// ---------------------------------------------------------------------------

describe('reencryptThumbnailToBody', () => {
  it('returns encrypted body without calling PATCH', async () => {
    const { deriveKey: dk, encryptBinary: eb, encrypt: enc, decrypt: dec, decryptBinary: deb } =
      await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    const fakeBytes = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const [oldDataEnc, oldNameEnc] = await Promise.all([
      eb(oldKey, fakeBytes),
      enc(oldKey, 'photo.jpg'),
    ]);

    vi.mocked(apiFetch).mockResolvedValueOnce([{ data_enc: oldDataEnc, original_name_enc: oldNameEnc }]);

    const result = await reencryptThumbnailToBody('img-2', oldKey, newKey);

    // Only the GET was made — no PATCH
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(result.imageId).toBe('img-2');
    expect(typeof result.data_enc).toBe('string');
    expect(typeof result.original_name_enc).toBe('string');

    // The new ciphertext must decrypt correctly with newKey
    const [decBytes, decName] = await Promise.all([
      deb(newKey, result.data_enc),
      dec(newKey, result.original_name_enc),
    ]);
    expect(Array.from(decBytes)).toEqual(Array.from(fakeBytes));
    expect(decName).toBe('photo.jpg');
  });

  it('returns empty strings when the thumbnail row is not found', async () => {
    const { deriveKey: dk } = await import('./crypto');
    const oldKey = await dk('old-pass', 'user@example.com');
    const newKey = await dk('new-pass', 'user@example.com');

    vi.mocked(apiFetch).mockResolvedValueOnce([]);

    const result = await reencryptThumbnailToBody('img-gone', oldKey, newKey);

    expect(result.imageId).toBe('img-gone');
    expect(result.data_enc).toBe('');
    expect(result.original_name_enc).toBe('');
  });
});
