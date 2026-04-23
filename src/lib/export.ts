import { apiFetch, apiFetchCount } from './api';
import { decryptBinary, bytesToBase64 } from './crypto';
import { getBookmarks, type Bookmark } from './bookmarks';
import { getTags } from './tags';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  format: 'json' | 'csv';
  /** Include uploaded thumbnail images as base64 data URIs. Default: true for JSON. */
  includeThumbnails: boolean;
  /** Max parallel thumbnail fetches. Default: 3. */
  thumbnailConcurrency?: number;
  /** What to do when a single thumbnail fetch/decrypt fails. */
  thumbnailErrorPolicy: 'skip' | 'abort';
}

export interface ExportProgress {
  phase: 'bookmarks' | 'tags' | 'thumbnails' | 'serializing';
  current: number;
  /** 0 means total is not yet known. */
  total: number;
  message: string;
}

export type ExportThumbnail =
  | { type: 'url'; value: string }
  | { type: 'data'; value: string; originalName: string };

export interface ExportBookmark {
  title: string;
  url: string;
  tags: string[];
  thumbnail: ExportThumbnail | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  totalBookmarks: number;
  bookmarks: ExportBookmark[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** Fetch and decrypt a thumbnail image, returning a base64 data URI. */
async function fetchThumbnailAsDataUri(
  imageId: string,
  key: CryptoKey,
  signal?: AbortSignal,
): Promise<string> {
  const rows = await apiFetch<{ data_enc: string }[]>(
    `/thumbnail_images?id=eq.${imageId}&select=data_enc`,
    { signal },
  );
  if (!rows?.length) throw new Error(`Thumbnail ${imageId} not found`);

  const bytes = await decryptBinary(key, rows[0].data_enc);

  // Defense-in-depth: assert JPEG magic bytes before embedding.
  // AES-GCM integrity prevents server tampering, but validates data stored
  // outside the normal upload path.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error(`Thumbnail ${imageId} is not a valid JPEG`);
  }

  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

/**
 * Run `worker` for each item in `items`, with at most `concurrency`
 * in-flight at once. Uses a shared index so workers self-balance.
 */
async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
  signal?: AbortSignal,
): Promise<void> {
  let index = 0;

  async function drain(): Promise<void> {
    while (index < items.length) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const i = index++;
      await worker(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, drain),
  );
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Fetch and decrypt all bookmarks, tags, and optionally thumbnails for the
 * current user, then return them as a portable ExportData object.
 *
 * All processing is client-side — the server never sees plaintext.
 */
export async function exportBookmarks(
  key: CryptoKey,
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportData> {
  const emit = onProgress ?? (() => {});

  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

  // Get total count upfront for richer progress messages (non-fatal if it fails)
  const total = await apiFetchCount('/bookmarks_with_tags?select=id&limit=0', signal);

  // --- Phase 1: Paginated bookmark fetch ---
  const allBookmarks: Bookmark[] = [];
  let offset = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

    const page = await getBookmarks(key, { limit: PAGE_SIZE, offset, signal });
    allBookmarks.push(...page);

    emit({
      phase: 'bookmarks',
      current: allBookmarks.length,
      total: total ?? 0,
      message: total
        ? `Fetching bookmark ${allBookmarks.length} of ${total}`
        : `Fetching bookmarks (${allBookmarks.length} so far)`,
    });

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // --- Phase 2: Tags ---
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

  emit({ phase: 'tags', current: 0, total: 1, message: 'Fetching tags' });
  const tags = await getTags(key, { signal });
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));
  emit({ phase: 'tags', current: 1, total: 1, message: 'Tags loaded' });

  // --- Phase 3: Thumbnails ---
  const thumbnailMap = new Map<string, ExportThumbnail | null>();

  if (options.includeThumbnails) {
    const withThumbs = allBookmarks.filter((b) => b.thumbnailFileId !== null);
    const thumbTotal = withThumbs.length;
    let thumbDone = 0;

    await runWithConcurrency(
      withThumbs,
      async (bookmark) => {
        try {
          const dataUri = await fetchThumbnailAsDataUri(bookmark.thumbnailFileId!, key, signal);
          thumbnailMap.set(bookmark.id, {
            type: 'data',
            value: dataUri,
            originalName: bookmark.thumbnailOriginalName ?? 'thumbnail.jpg',
          });
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (options.thumbnailErrorPolicy === 'abort') throw err;
          // skip policy: record null and continue
          thumbnailMap.set(bookmark.id, null);
        }
        thumbDone++;
        emit({
          phase: 'thumbnails',
          current: thumbDone,
          total: thumbTotal,
          message: `Fetching thumbnail ${thumbDone} of ${thumbTotal}`,
        });
      },
      options.thumbnailConcurrency ?? 3,
      signal,
    );
  }

  // --- Phase 4: Serialize ---
  emit({ phase: 'serializing', current: 0, total: 1, message: 'Building export' });

  const exportedBookmarks: ExportBookmark[] = allBookmarks.map((b) => {
    let thumbnail: ExportThumbnail | null = null;

    if (options.includeThumbnails && b.thumbnailFileId) {
      thumbnail = thumbnailMap.get(b.id) ?? null;
    }

    // Direct URL thumbnails always pass through regardless of includeThumbnails
    if (!thumbnail && b.thumbnailUrl) {
      thumbnail = { type: 'url', value: b.thumbnailUrl };
    }

    return {
      title: b.title,
      url: b.url,
      tags: b.tagIds.map((id) => tagMap.get(id) ?? id),
      thumbnail,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    totalBookmarks: exportedBookmarks.length,
    bookmarks: exportedBookmarks,
  };
}

// ---------------------------------------------------------------------------
// CSV serialization
// ---------------------------------------------------------------------------

/** Sanitize a cell value for CSV: quote it, escape internal quotes, and
 *  prefix formula-injection characters with a tab to prevent spreadsheet execution. */
function csvSanitize(value: string): string {
  let safe = value;
  if (
    safe.length > 0 &&
    (safe[0] === '=' || safe[0] === '+' || safe[0] === '-' || safe[0] === '@')
  ) {
    safe = '\t' + safe;
  }
  return '"' + safe.replace(/"/g, '""') + '"';
}

/**
 * Serialize ExportData to RFC 4180 CSV. Binary thumbnails are omitted;
 * direct URL thumbnails are included in the thumbnailUrl column.
 * CSV is the lossy format — use JSON for full-fidelity backup including thumbnails.
 */
export function exportToCsv(data: ExportData): string {
  const header = 'title,url,tags,thumbnailUrl,createdAt,updatedAt';
  const rows = data.bookmarks.map((b) => {
    const thumbUrl = b.thumbnail?.type === 'url' ? b.thumbnail.value : '';
    return [
      csvSanitize(b.title),
      csvSanitize(b.url),
      csvSanitize(b.tags.join('|')),
      csvSanitize(thumbUrl),
      csvSanitize(b.createdAt),
      csvSanitize(b.updatedAt),
    ].join(',');
  });
  return [header, ...rows].join('\r\n');
}

// ---------------------------------------------------------------------------
// Download trigger
// ---------------------------------------------------------------------------

/**
 * Trigger a browser file download for the given Blob.
 * The object URL is always revoked (via try/finally) to prevent memory leaks.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
