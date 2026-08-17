// =============================================================================
// Key rotation — re-encrypt every record with a new key, then stamp the target
// key_version so change_password can commit the rotation.
//
// Shared by ChangePasswordModal (rotates everything) and RecoveryModal
// (rotates only the records left behind by an interrupted attempt). Both used
// to inline this logic with unbounded `Promise.all` fan-outs.
//
// SECURITY / DATA-INTEGRITY INVARIANTS
//
//  1. Reads before writes. Every read and every crypto operation completes
//     before the first write is issued. The previous flow PATCHed all
//     bookmarks *before* reading the thumbnail rows, so a failed read left
//     every bookmark re-encrypted under the new key while change_password was
//     never called -- i.e. encrypted with a key the user's password no longer
//     derives, recoverable only through RecoveryModal with the exact same
//     intended new password.
//
//  2. Bounded fan-out with retry. Thumbnail reads and writes both land in
//     Nginx's `api_read` limit_req zone (rate=60r/m, burst=20), which absorbs
//     only ~21 requests in a short burst. An unbounded fan-out over 23
//     thumbnails issued 46 requests in two instantaneous bursts and was
//     rate-limited into exactly the partial-rotation state above.
//
//  3. PATCH, never upsert. PostgREST's `resolution=merge-duplicates` would let
//     us update many rows per request, but it runs as INSERT ... ON CONFLICT,
//     which fires the BEFORE INSERT trigger in 13_key_version_stamp.sql and
//     would overwrite key_version with the caller's *committed* version --
//     reverting the very stamp a rotation depends on.
// =============================================================================

import { reencryptBookmark, type Bookmark } from './bookmarks';
import { reencryptTag } from './tags';
import {
  reencryptThumbnailBatchToBodies,
  writeReencryptedThumbnail,
  type ThumbnailRotationBody,
} from './thumbnails';
import { chunk, runWithConcurrency, withRetry, type RetryOptions } from './utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Rows per batched thumbnail read. Bounded by the 4 MiB per-row data_enc cap
// (docker/db/init/12_encrypted_column_size_caps.sql) rather than URL length.
const THUMBNAIL_READ_BATCH_SIZE = 10;

// Writes must stay per-row (invariant 3), so the request count cannot be
// reduced -- only paced. A small bound plus retry keeps the burst inside the
// api_read budget and lets the leaky bucket drain between waves.
const WRITE_CONCURRENCY = 3;

// The api_read bucket drains at 1 request/second, so N per-row writes need
// roughly N seconds of draining once the burst allowance is spent. The retry
// window therefore has to span that: measured against the real limiter with a
// freshly-drained bucket, 23 thumbnail writes need up to 7 attempts and clear
// in ~23s. Four attempts (~5.6s) left roughly one write per rotation
// permanently rejected — i.e. still a partial rotation.
const RETRY_ATTEMPTS = 8;
const RETRY_BASE_MS = 800;

// Cap the doubling so no single wait reads as a hung UI; the attempt count,
// not the individual delay, is what covers a long queue.
const RETRY_MAX_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RotationTag {
  id: string;
  name: string;
}

export interface RotationInput {
  /** Bookmarks whose text fields need re-encrypting (already decrypted). */
  bookmarks: Bookmark[];
  /** thumbnail_images rows to re-encrypt. */
  thumbnailImageIds: string[];
  /** Tags whose names need re-encrypting (already decrypted). */
  tags: RotationTag[];
  oldKey: CryptoKey;
  newKey: CryptoKey;
  /** The key_version every rotated row is stamped with. */
  targetVersion: number;
  signal?: AbortSignal;
  /** Base retry backoff; overridable so tests do not sleep for real. */
  retryBaseMs?: number;
}

// ---------------------------------------------------------------------------
// Phase A — reads and crypto only, no writes
// ---------------------------------------------------------------------------

/**
 * Read and re-encrypt every thumbnail, chunked so the read burst stays inside
 * the shared rate-limit budget. Throws if any row is unreadable, before any
 * write has been issued.
 */
async function prepareThumbnailBodies(
  imageIds: string[],
  oldKey: CryptoKey,
  newKey: CryptoKey,
  retry: RetryOptions,
): Promise<ThumbnailRotationBody[]> {
  const bodies: ThumbnailRotationBody[] = [];

  // Sequential across batches: rotation is not latency-sensitive, and pacing
  // the reads keeps headroom in the shared rate-limit budget for the writes.
  for (const group of chunk(imageIds, THUMBNAIL_READ_BATCH_SIZE)) {
    bodies.push(
      ...(await withRetry(
        () => reencryptThumbnailBatchToBodies(group, oldKey, newKey, retry.signal),
        retry,
      )),
    );
  }

  return bodies;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Re-encrypt every supplied record with `newKey` and stamp `targetVersion`.
 *
 * Resolves only once every write has landed, so the caller may treat a
 * successful return as "safe to call change_password". Rejects without having
 * written anything if the read phase fails.
 */
export async function reencryptRecords(input: RotationInput): Promise<void> {
  const { bookmarks, thumbnailImageIds, tags, oldKey, newKey, targetVersion, signal } = input;

  const retry: RetryOptions = {
    attempts: RETRY_ATTEMPTS,
    baseMs: input.retryBaseMs ?? RETRY_BASE_MS,
    maxDelayMs: RETRY_MAX_DELAY_MS,
    signal,
  };

  // --- Phase A: reads + crypto. A failure here leaves the DB untouched. ---
  const thumbnailBodies = await prepareThumbnailBodies(
    thumbnailImageIds,
    oldKey,
    newKey,
    retry,
  );

  // --- Phase B: writes. ---
  // Thumbnails first: they are the only writes that share the rate-limited
  // zone, so they get the budget while it is freshest.
  await runWithConcurrency(
    thumbnailBodies,
    (body) => withRetry(() => writeReencryptedThumbnail(body, targetVersion), retry),
    WRITE_CONCURRENCY,
    signal,
  );

  await runWithConcurrency(
    bookmarks,
    (bm) => withRetry(() => reencryptBookmark(bm, newKey, targetVersion), retry),
    WRITE_CONCURRENCY,
    signal,
  );

  await runWithConcurrency(
    tags,
    (tag) => withRetry(() => reencryptTag(tag.id, tag.name, newKey, targetVersion), retry),
    WRITE_CONCURRENCY,
    signal,
  );
}
