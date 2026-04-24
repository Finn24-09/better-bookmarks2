import { apiFetch } from './api';
import { encrypt, decrypt } from './crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw shape returned by PostgREST from the bookmarks_with_tags view. */
export interface BookmarkRow {
  id: string;
  user_id: string;
  title_enc: string;
  url_enc: string;
  thumbnail_url_enc: string | null;
  thumbnail_file_id: string | null;
  thumbnail_original_name_enc: string | null;
  created_at: string;
  updated_at: string;
  tag_ids: string[];
}

/** Decrypted bookmark ready for the UI. */
export interface Bookmark {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  /** UUID of an uploaded thumbnail image (api.thumbnail_images), or null. */
  thumbnailFileId: string | null;
  /** Decrypted original filename of the uploaded thumbnail, or null. */
  thumbnailOriginalName: string | null;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface GetBookmarksOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export async function getBookmarks(
  key: CryptoKey,
  options: GetBookmarksOptions = {},
): Promise<Bookmark[]> {
  const params = new URLSearchParams({ order: 'created_at.desc' });
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));

  const rows = await apiFetch<BookmarkRow[]>(`/bookmarks_with_tags?${params}`, {
    signal: options.signal,
  });
  return Promise.all((rows ?? []).map((r) => decryptBookmark(r, key)));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateBookmarkInput {
  title: string;
  url: string;
  thumbnailUrl?: string | null;
  /** UUID of an already-uploaded thumbnail_images row, if using file upload. */
  thumbnailFileId?: string | null;
}

export async function createBookmark(
  input: CreateBookmarkInput,
  key: CryptoKey,
  userId: string,
): Promise<{ id: string }> {
  // File upload and URL thumbnail are mutually exclusive.
  const usingFile = !!input.thumbnailFileId;

  const body: Record<string, string | null> = {
    user_id: userId,
    title_enc: await encrypt(key, input.title),
    url_enc: await encrypt(key, input.url),
    thumbnail_url_enc: (!usingFile && input.thumbnailUrl)
      ? await encrypt(key, input.thumbnailUrl)
      : null,
    thumbnail_file_id: input.thumbnailFileId ?? null,
  };

  const rows = await apiFetch<{ id: string }[]>('/bookmarks', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateBookmark(
  id: string,
  input: CreateBookmarkInput,
  key: CryptoKey,
): Promise<void> {
  const usingFile = !!input.thumbnailFileId;

  const body: Record<string, string | null> = {
    title_enc: await encrypt(key, input.title),
    url_enc: await encrypt(key, input.url),
    thumbnail_url_enc: (!usingFile && input.thumbnailUrl)
      ? await encrypt(key, input.thumbnailUrl)
      : null,
    thumbnail_file_id: input.thumbnailFileId ?? null,
    updated_at: new Date().toISOString(),
  };

  await apiFetch(`/bookmarks?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Re-encrypt (key rotation on password change)
// ---------------------------------------------------------------------------

/** Re-encrypt all encrypted fields of a bookmark with a new key. */
export async function reencryptBookmark(bm: Bookmark, newKey: CryptoKey): Promise<void> {
  const body: Record<string, string | null> = {
    title_enc: await encrypt(newKey, bm.title),
    url_enc: await encrypt(newKey, bm.url),
    thumbnail_url_enc: bm.thumbnailUrl ? await encrypt(newKey, bm.thumbnailUrl) : null,
    updated_at: new Date().toISOString(),
  };
  await apiFetch(`/bookmarks?id=eq.${bm.id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteBookmark(id: string): Promise<void> {
  await apiFetch(`/bookmarks?id=eq.${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function decryptBookmark(row: BookmarkRow, key: CryptoKey): Promise<Bookmark> {
  const [title, url, thumbnailUrl, thumbnailOriginalName] = await Promise.all([
    decrypt(key, row.title_enc),
    decrypt(key, row.url_enc),
    row.thumbnail_url_enc ? decrypt(key, row.thumbnail_url_enc) : Promise.resolve(null),
    row.thumbnail_original_name_enc
      ? decrypt(key, row.thumbnail_original_name_enc)
      : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    title,
    url,
    thumbnailUrl,
    thumbnailFileId: row.thumbnail_file_id ?? null,
    thumbnailOriginalName,
    tagIds: row.tag_ids ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
