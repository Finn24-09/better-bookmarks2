import { apiFetch } from './api';
import { encrypt, decrypt, computeHmac } from './crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagRow {
  id: string;
  user_id: string;
  name_enc: string;
  name_hmac: string;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function getTags(key: CryptoKey): Promise<Tag[]> {
  const rows = await apiFetch<TagRow[]>('/tags?order=created_at.asc');
  return Promise.all(
    rows.map(async (r) => ({ id: r.id, name: await decrypt(key, r.name_enc) })),
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createTag(name: string, userId: string, key: CryptoKey): Promise<Tag> {
  const [name_enc, name_hmac] = await Promise.all([
    encrypt(key, name),
    computeHmac(userId, name),
  ]);

  const rows = await apiFetch<TagRow[]>('/tags', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, name_enc, name_hmac }),
  });

  return { id: rows[0].id, name };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteTag(id: string): Promise<void> {
  await apiFetch(`/tags?id=eq.${id}`, { method: 'DELETE' });
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
