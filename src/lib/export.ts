import { apiFetch, apiFetchCount } from './api';
import { decryptBinary, bytesToBase64 } from './crypto';
import { getBookmarks, type Bookmark } from './bookmarks';
import { getTags } from './tags';
import { runWithConcurrency, chunk, isAbortError, withRetry } from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  format: 'json' | 'csv';
  /** Include uploaded thumbnail images as base64 data URIs. Default: true for JSON. */
  includeThumbnails: boolean;
  /** Max parallel thumbnail batches in flight. Default: 3. */
  thumbnailConcurrency?: number;
  /**
   * What to do when a single thumbnail row is permanently unusable (missing
   * row, undecryptable payload, not a JPEG). Transient transport failures are
   * never governed by this — they are retried and then fatal either way.
   */
  thumbnailErrorPolicy: 'skip' | 'abort';
  /** Attempts per thumbnail batch before a transient failure becomes fatal. Default: 3. */
  thumbnailRetryAttempts?: number;
  /** Base backoff between batch retries, in ms. Default: 800. */
  thumbnailRetryBaseMs?: number;
}

export interface ExportProgress {
  phase: 'bookmarks' | 'tags' | 'thumbnails' | 'serializing';
  current: number;
  /** 0 means total is not yet known. */
  total: number;
  message: string;
  /**
   * Thumbnails permanently omitted from the export so far. Emitted on
   * `thumbnails`-phase events so the UI can warn that the backup is
   * incomplete instead of reporting an unqualified success.
   */
  skipped?: number;
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

// Hard ceiling on pagination to defeat a runaway loop if the server (or
// a man-in-the-middle proxy) returns the same full page indefinitely.
// 5000-bookmark limit (matches the JSON import cap in importJson.ts) ÷
// PAGE_SIZE = 50 pages; we round up to 100 for headroom. (CR-024)
const MAX_PAGES = 100;

// Thumbnail rows fetched per request via PostgREST `id=in.(...)`.
//
// One request per thumbnail overran Nginx's `api_read` limit_req zone
// (rate=60r/m, burst=20 — ~21 requests per short burst, shared with the
// bookmark grid's own thumbnail loads), so a 23-thumbnail export needed 25
// requests and silently lost whatever nginx 429'd. Batching by 10 turns that
// into 3 requests.
//
// 10 rather than a larger chunk because `thumbnail_images.data_enc` is capped
// at 4 MiB per row (docker/db/init/12_encrypted_column_size_caps.sql), so a
// batch holds up to 40 MiB of ciphertext plus its base64 expansion in memory —
// bounded enough to survive a phone, with `thumbnailConcurrency` batches in
// flight. Real rows are ~40 KB (480x270 JPEG q0.75). The id list also stays
// far inside nginx's 8 KB request-line limit (10 UUIDs is ~380 bytes).
const THUMBNAIL_BATCH_SIZE = 10;

const RETRY_ATTEMPTS = 3;

// The api_read bucket drains at 1 request/second, so a sub-second retry is
// guaranteed to be rejected again. 800 ms doubling gives the bucket time to
// refill between attempts.
const RETRY_BASE_MS = 800;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch one batch of encrypted thumbnail rows, keyed by image id. */
async function fetchThumbnailBatch(
  imageIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const rows = await apiFetch<{ id: string; data_enc: string }[]>(
    `/thumbnail_images?id=in.(${imageIds.join(',')})&select=id,data_enc`,
    { signal },
  );
  return new Map((rows ?? []).map((r) => [r.id, r.data_enc]));
}

/** Decrypt one encrypted thumbnail payload into a base64 data URI. */
async function toDataUri(key: CryptoKey, dataEnc: string, imageId: string): Promise<string> {
  const bytes = await decryptBinary(key, dataEnc);

  // Defense-in-depth: assert JPEG magic bytes before embedding.
  // AES-GCM integrity prevents server tampering, but validates data stored
  // outside the normal upload path.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error(`Thumbnail ${imageId} is not a valid JPEG`);
  }

  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
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
  let pageCount = 0;

  while (pageCount < MAX_PAGES) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

    const page = await getBookmarks(key, { limit: PAGE_SIZE, offset, signal });
    allBookmarks.push(...page);
    pageCount++;

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

  if (pageCount >= MAX_PAGES) {
    throw new Error(`Export exceeded the maximum of ${MAX_PAGES * PAGE_SIZE} bookmarks`);
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
    const attempts = options.thumbnailRetryAttempts ?? RETRY_ATTEMPTS;
    const baseMs = options.thumbnailRetryBaseMs ?? RETRY_BASE_MS;
    let thumbDone = 0;
    let thumbSkipped = 0;

    await runWithConcurrency(
      chunk(withThumbs, THUMBNAIL_BATCH_SIZE),
      async (batch) => {
        let rowsById: Map<string, string>;
        try {
          rowsById = await withRetry(
            () => fetchThumbnailBatch(batch.map((b) => b.thumbnailFileId!), signal),
            { attempts, baseMs, signal },
          );
        } catch (err) {
          if (isAbortError(err)) throw err;
          // A batch that could not be read at all is an infrastructure failure
          // affecting up to THUMBNAIL_BATCH_SIZE thumbnails, not a defect in any
          // one of them. Silently nulling them produced backups that looked
          // complete but were missing most images, so this is always fatal —
          // thumbnailErrorPolicy governs per-row defects only.
          throw new Error(
            `Could not download all thumbnails after ${attempts} attempt(s). ` +
              'The export was stopped rather than saving a file with silently missing ' +
              `thumbnails. (${err instanceof Error ? err.message : String(err)})`,
          );
        }

        // The fetch resolving does not mean the export is still wanted.
        if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

        for (const bookmark of batch) {
          try {
            const dataEnc = rowsById.get(bookmark.thumbnailFileId!);
            if (dataEnc === undefined) {
              throw new Error(`Thumbnail ${bookmark.thumbnailFileId} not found`);
            }
            thumbnailMap.set(bookmark.id, {
              type: 'data',
              value: await toDataUri(key, dataEnc, bookmark.thumbnailFileId!),
              originalName: bookmark.thumbnailOriginalName ?? 'thumbnail.jpg',
            });
          } catch (err) {
            if (isAbortError(err)) throw err;
            if (options.thumbnailErrorPolicy === 'abort') throw err;
            // The row is permanently unusable (orphaned, undecryptable, or not
            // a JPEG). Retrying cannot help, so record the omission and report
            // the count so the user knows the backup is incomplete.
            thumbnailMap.set(bookmark.id, null);
            thumbSkipped++;
          }
          thumbDone++;
          emit({
            phase: 'thumbnails',
            current: thumbDone,
            total: thumbTotal,
            message: `Fetching thumbnail ${thumbDone} of ${thumbTotal}`,
            skipped: thumbSkipped,
          });
        }
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
 *  prefix formula-injection characters with a literal single quote. (M-08)
 *
 *  Excel and LibreOffice Calc both treat a leading `'` as the "literal text"
 *  prefix and do not evaluate the cell content. The earlier `\t` prefix was
 *  OWASP-mentioned but documented-as-imperfect; some Calc versions strip
 *  leading whitespace before evaluating. The csv.ts importer mirrors this:
 *  it strips a leading `'` ONLY when the next character is a formula
 *  trigger, so titles that legitimately begin with an apostrophe round-trip
 *  unchanged. */
function csvSanitize(value: string): string {
  let safe = value;
  if (
    safe.length > 0 &&
    (safe[0] === '=' || safe[0] === '+' || safe[0] === '-' || safe[0] === '@')
  ) {
    safe = "'" + safe;
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
