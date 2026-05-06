import { apiFetch } from './api';
import { encrypt, decrypt, computeHmac } from './crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum allowed length (in characters) for a tag name.
 * Shared with `importJson.ts` so import and rename agree on the same ceiling;
 * a single source of truth keeps validation messages consistent across UIs.
 */
export const MAX_TAG_LENGTH = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagRow {
  id: string;
  user_id: string;
  name_enc: string;
  name_hmac: string;
  created_at: string;
  key_version: number;
}

export interface Tag {
  id: string;
  name: string;
  keyVersion: number;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function getTags(
  key: CryptoKey,
  options?: { signal?: AbortSignal },
): Promise<Tag[]> {
  const rows = await apiFetch<TagRow[]>('/tags?order=created_at.asc', {
    signal: options?.signal,
  });
  return Promise.all(
    (rows ?? []).map(async (r) => ({
      id: r.id,
      name: await decrypt(key, r.name_enc),
      keyVersion: r.key_version ?? 1,
    })),
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createTag(name: string, userId: string, key: CryptoKey): Promise<Tag> {
  // Trim before encrypt + HMAC: the unique constraint is keyed on name_hmac,
  // so " Personal " and "Personal" must collide — otherwise users can store
  // visually-identical duplicates that bypass dedup.
  const trimmed = name.trim();
  const [name_enc, name_hmac] = await Promise.all([
    encrypt(key, trimmed),
    computeHmac(userId, trimmed),
  ]);

  const rows = await apiFetch<TagRow[]>('/tags', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, name_enc, name_hmac }),
  });

  return { id: rows[0].id, name: trimmed, keyVersion: rows[0].key_version ?? 1 };
}

// ---------------------------------------------------------------------------
// Update (rename)
// ---------------------------------------------------------------------------

/**
 * Rename a tag. Re-encrypts `name_enc` with the existing key and recomputes
 * `name_hmac` against `userId`, which preserves the `UNIQUE(user_id, name_hmac)`
 * dedup invariant. The encryption key is unchanged, so `key_version` is NOT
 * sent in the body — including it would cross-contaminate the rotation tracker.
 * `user_id` is also omitted: RLS enforces ownership and the column is immutable.
 */
export async function updateTag(
  id: string,
  newName: string,
  userId: string,
  key: CryptoKey,
  options?: { signal?: AbortSignal },
): Promise<void> {
  const trimmed = newName.trim();
  const [name_enc, name_hmac] = await Promise.all([
    encrypt(key, trimmed),
    computeHmac(userId, trimmed),
  ]);
  await apiFetch(`/tags?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name_enc, name_hmac }),
    signal: options?.signal,
  });
}

// ---------------------------------------------------------------------------
// Re-encrypt (key rotation on password change)
// ---------------------------------------------------------------------------

/**
 * Re-encrypt a tag's name_enc with a new key.
 * name_hmac is keyed on userId (not the password) so it never changes.
 */
export async function reencryptTag(
  id: string,
  name: string,
  newKey: CryptoKey,
  targetVersion: number,
): Promise<void> {
  const name_enc = await encrypt(newKey, name);
  await apiFetch(`/tags?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name_enc, key_version: targetVersion }),
  });
}

/** Fetch raw (encrypted) tag rows without decrypting — used during key-rotation recovery. */
export async function getTagRows(): Promise<TagRow[]> {
  const rows = await apiFetch<TagRow[]>('/tags?order=created_at.asc');
  return rows ?? [];
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteTag(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<void> {
  await apiFetch(`/tags?id=eq.${id}`, { method: 'DELETE', signal: options?.signal });
}

// ---------------------------------------------------------------------------
// Bookmark–tag junction
// ---------------------------------------------------------------------------

/** Replace the full set of tags on a bookmark (diff → add new, remove stale). */
export async function setBookmarkTags(
  bookmarkId: string,
  newTagIds: string[],
  currentTagIds: string[],
): Promise<void> {
  const toAdd    = newTagIds.filter((id) => !currentTagIds.includes(id));
  const toRemove = currentTagIds.filter((id) => !newTagIds.includes(id));

  await Promise.all([
    ...toAdd.map((tagId) =>
      apiFetch('/bookmark_tags', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ bookmark_id: bookmarkId, tag_id: tagId }),
      }),
    ),
    ...toRemove.map((tagId) =>
      apiFetch(
        `/bookmark_tags?bookmark_id=eq.${bookmarkId}&tag_id=eq.${tagId}`,
        { method: 'DELETE' },
      ),
    ),
  ]);
}
