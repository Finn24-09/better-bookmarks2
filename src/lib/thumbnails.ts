import { apiFetch } from './api';
import { encrypt, encryptBinary, decryptBinary, decrypt } from './crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WIDTH = 480;
const MAX_HEIGHT = 270;
const JPEG_QUALITY = 0.75;

// ---------------------------------------------------------------------------
// Image compression
// ---------------------------------------------------------------------------

/**
 * Resize and compress an image File to fit within 480×270 px, outputting JPEG
 * at quality 0.75. Images smaller than the maximum are not upscaled.
 * Uses the browser Canvas API.
 */
export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // Compute scale-down ratio — never scale up
      const ratio = Math.min(MAX_WIDTH / img.width, MAX_HEIGHT / img.height, 1);
      const width = Math.round(img.width * ratio);
      const height = Math.round(img.height * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas 2D context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob returned null'));
        },
        'image/jpeg',
        JPEG_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

// ---------------------------------------------------------------------------
// Raw type returned by PostgREST
// ---------------------------------------------------------------------------

interface ThumbnailImageRow {
  id: string;
}

interface ThumbnailDataRow {
  data_enc: string;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Encrypt and upload raw JPEG bytes (already decoded from a data URI).
 * Skips the compress step — used when re-importing from a JSON export where
 * the bytes were already compressed at export time.
 * Returns the UUID of the newly created thumbnail_images row.
 */
export async function uploadThumbnailFromBytes(
  bytes: Uint8Array<ArrayBuffer>,
  originalName: string,
  key: CryptoKey,
  userId: string,
): Promise<string> {
  const [dataEnc, originalNameEnc] = await Promise.all([
    encryptBinary(key, bytes),
    encrypt(key, originalName),
  ]);

  const rows = await apiFetch<ThumbnailImageRow[]>('/thumbnail_images', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: userId,
      data_enc: dataEnc,
      original_name_enc: originalNameEnc,
    }),
  });

  return rows[0].id;
}

/**
 * Compress, encrypt, and upload a thumbnail image.
 * Returns the UUID of the newly created thumbnail_images row.
 */
export async function uploadThumbnail(
  file: File,
  key: CryptoKey,
  userId: string,
): Promise<string> {
  // 1. Compress
  const compressed = await compressImage(file);

  // 2. Read compressed bytes
  const arrayBuffer = await compressed.arrayBuffer();
  const imageBytes = new Uint8Array(arrayBuffer);

  // 3. Encrypt binary image data + original filename
  const [dataEnc, originalNameEnc] = await Promise.all([
    encryptBinary(key, imageBytes),
    encrypt(key, file.name),
  ]);

  // 4. POST to API
  const rows = await apiFetch<ThumbnailImageRow[]>('/thumbnail_images', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: userId,
      data_enc: dataEnc,
      original_name_enc: originalNameEnc,
    }),
  });

  return rows[0].id;
}

// ---------------------------------------------------------------------------
// Fetch / display
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt a thumbnail image, returning a blob object URL for use
 * in an <img> src. The caller is responsible for revoking the URL via
 * URL.revokeObjectURL() when it is no longer needed.
 */
export async function fetchThumbnailObjectUrl(
  imageId: string,
  key: CryptoKey,
): Promise<string> {
  const rows = await apiFetch<ThumbnailDataRow[]>(
    `/thumbnail_images?id=eq.${imageId}&select=data_enc`,
  );
  if (!rows.length) throw new Error('Thumbnail image not found');

  const imageBytes = await decryptBinary(key, rows[0].data_enc);
  const blob = new Blob([imageBytes], { type: 'image/jpeg' });
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Re-encrypt (key rotation on password change)
// ---------------------------------------------------------------------------

/**
 * Fetch, decrypt with oldKey, re-encrypt with newKey, and write both the
 * binary data and original filename back to thumbnail_images.
 *
 * The original filename is sourced from the server (original_name_enc) rather
 * than a caller-supplied string, preventing silent overwrites with empty values.
 */
export async function reencryptThumbnail(
  imageId: string,
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  const rows = await apiFetch<{ data_enc: string; original_name_enc: string }[]>(
    `/thumbnail_images?id=eq.${imageId}&select=data_enc,original_name_enc`,
  );
  if (!rows?.length) return;

  const [imageBytes, originalName] = await Promise.all([
    decryptBinary(oldKey, rows[0].data_enc),
    decrypt(oldKey, rows[0].original_name_enc),
  ]);

  const [newDataEnc, newOriginalNameEnc] = await Promise.all([
    encryptBinary(newKey, imageBytes),
    encrypt(newKey, originalName),
  ]);

  await apiFetch(`/thumbnail_images?id=eq.${imageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ data_enc: newDataEnc, original_name_enc: newOriginalNameEnc }),
  });
}

/**
 * Fetch, decrypt, and re-encrypt a thumbnail's binary data and original name
 * in memory — returns the encrypted body without writing to the DB.
 * Use this for the two-phase key rotation in ChangePasswordModal so all crypto
 * completes before any DB writes begin.
 */
export async function reencryptThumbnailToBody(
  imageId: string,
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<{ imageId: string; data_enc: string; original_name_enc: string }> {
  const rows = await apiFetch<{ data_enc: string; original_name_enc: string }[]>(
    `/thumbnail_images?id=eq.${imageId}&select=data_enc,original_name_enc`,
  );
  if (!rows?.length) return { imageId, data_enc: '', original_name_enc: '' };

  const [imageBytes, originalName] = await Promise.all([
    decryptBinary(oldKey, rows[0].data_enc),
    decrypt(oldKey, rows[0].original_name_enc),
  ]);

  const [newDataEnc, newOriginalNameEnc] = await Promise.all([
    encryptBinary(newKey, imageBytes),
    encrypt(newKey, originalName),
  ]);

  return { imageId, data_enc: newDataEnc, original_name_enc: newOriginalNameEnc };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Permanently delete a thumbnail_images row by id. */
export async function deleteThumbnailImage(imageId: string): Promise<void> {
  await apiFetch(`/thumbnail_images?id=eq.${imageId}`, { method: 'DELETE' });
}
