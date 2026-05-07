import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBookmark, updateBookmark, deleteBookmark, reencryptBookmark, getBookmarkRows, decryptBookmark } from './bookmarks';
import type { Bookmark, BookmarkRow } from './bookmarks';
import { deriveKey, decrypt } from './crypto';
import { setAuthToken, ApiError } from './api';

const USER_ID = 'user-uuid-123';
const TITLE = 'My Bookmark';
const URL = 'https://example.com';

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-reenc-1',
    title: 'Re-encrypt Me',
    url: 'https://example.com/reenc',
    thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    thumbnailFileId: 'img-uuid-reenc',
    thumbnailOriginalName: 'photo.jpg',
    tagIds: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    keyVersion: 1,
    thumbnailKeyVersion: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<BookmarkRow> = {}): BookmarkRow {
  return {
    id: 'bm-1',
    user_id: USER_ID,
    title_enc: 'x',
    url_enc: 'x',
    thumbnail_url_enc: null,
    thumbnail_file_id: null,
    thumbnail_original_name_enc: null,
    created_at: '',
    updated_at: '',
    tag_ids: [],
    key_version: 1,
    thumbnail_key_version: null,
    ...overrides,
  };
}

// Minimal bookmark row for POST response
function bookmarkRow(id = 'bm-1') {
  return [makeRow({ id })];
}

describe('bookmarks', () => {
  let key: CryptoKey;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    key = await deriveKey('password123', 'test@example.com');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  // -------------------------------------------------------------------------
  // createBookmark — request body
  // -------------------------------------------------------------------------
  it('createBookmark includes user_id in POST body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.user_id).toBe(USER_ID);
  });

  it('createBookmark encrypts title (ciphertext ≠ plaintext)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.title_enc).not.toBe(TITLE);
  });

  it('createBookmark encrypts url (ciphertext ≠ plaintext)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.url_enc).not.toBe(URL);
  });

  it('createBookmark encrypted title decrypts back to original', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decrypted = await decrypt(key, body.title_enc);
    expect(decrypted).toBe(TITLE);
  });

  it('createBookmark sets thumbnail_url_enc to null when not provided', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thumbnail_url_enc).toBeNull();
  });

  it('createBookmark encrypts thumbnailUrl when provided', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL, thumbnailUrl: 'https://thumb.com/img.jpg' }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thumbnail_url_enc).not.toBeNull();
    expect(body.thumbnail_url_enc).not.toBe('https://thumb.com/img.jpg');
  });

  it('createBookmark returns the id from the server response', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow('bm-xyz') });

    const result = await createBookmark({ title: TITLE, url: URL }, key, USER_ID);
    expect(result.id).toBe('bm-xyz');
  });

  // -------------------------------------------------------------------------
  // createBookmark — server rejects oversized title_enc (issue #23)
  // -------------------------------------------------------------------------
  it('createBookmark surfaces a sanitised ApiError when the server rejects an oversized title_enc with 400', async () => {
    // Same shape as the updateTag test in tags.test.ts — locks the contract
    // that bookmarks_title_enc_size_cap rejection messages don't leak the
    // constraint name or table name through createBookmark either.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: '23514',
        message:
          'new row for relation "bookmarks" violates check constraint "bookmarks_title_enc_size_cap"',
        details: 'Failing row contains (..., <oversized base64 blob>, ...).',
        hint: null,
      }),
    });

    const caught = await createBookmark({ title: TITLE, url: URL }, key, USER_ID).catch((e) => e) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe('Request failed (400)');
    expect(caught.message).not.toContain('bookmarks_title_enc_size_cap');
    expect(caught.message).not.toContain('relation "bookmarks"');
    // Belt-and-braces: even if the future fallback message changes, neither
    // the constraint-violation phrase nor the PostgREST `details` body must
    // reach the user.
    expect(caught.message).not.toContain('check constraint');
    expect(caught.message).not.toContain('Failing row');
  });

  // -------------------------------------------------------------------------
  // updateBookmark — server rejects oversized title_enc (issue #23)
  // -------------------------------------------------------------------------
  it('updateBookmark surfaces a sanitised ApiError when the server rejects an oversized title_enc with 400', async () => {
    // Same shape as the createBookmark sanitisation test above and the
    // updateTag one in tags.test.ts -- locks the contract that
    // bookmarks_title_enc_size_cap rejection messages don't leak the
    // constraint name or table name through the updateBookmark call site
    // either.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: '23514',
        message:
          'new row for relation "bookmarks" violates check constraint "bookmarks_title_enc_size_cap"',
        details: 'Failing row contains (..., <oversized base64 blob>, ...).',
        hint: null,
      }),
    });

    const caught = await updateBookmark('bm-abc', { title: 'T', url: 'https://x.com' }, key).catch((e) => e) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe('Request failed (400)');
    expect(caught.message).not.toContain('bookmarks_title_enc_size_cap');
    expect(caught.message).not.toContain('relation "bookmarks"');
    expect(caught.message).not.toContain('check constraint');
    expect(caught.message).not.toContain('Failing row');
  });

  // -------------------------------------------------------------------------
  // createBookmark — server rejects oversized url_enc (issue #23)
  // -------------------------------------------------------------------------
  it('createBookmark surfaces a sanitised ApiError when the server rejects an oversized url_enc with 400', async () => {
    // Pairs with the title_enc test above; together they give every bookmarks-
    // table size-cap constraint named coverage. tags_name_enc_size_cap is
    // covered in tags.test.ts; the two thumbnail_images_* constraints are
    // covered indirectly via api.test.ts's generic non-auth 400 test.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: '23514',
        message:
          'new row for relation "bookmarks" violates check constraint "bookmarks_url_enc_size_cap"',
        details: 'Failing row contains (..., <oversized base64 blob>, ...).',
        hint: null,
      }),
    });

    const caught = await createBookmark({ title: TITLE, url: URL }, key, USER_ID).catch((e) => e) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe('Request failed (400)');
    expect(caught.message).not.toContain('bookmarks_url_enc_size_cap');
    expect(caught.message).not.toContain('relation "bookmarks"');
    expect(caught.message).not.toContain('check constraint');
    expect(caught.message).not.toContain('Failing row');
  });

  // -------------------------------------------------------------------------
  // createBookmark — server rejects oversized thumbnail_url_enc (issue #23)
  // -------------------------------------------------------------------------
  it('createBookmark surfaces a sanitised ApiError when the server rejects an oversized thumbnail_url_enc with 400', async () => {
    // Closes the named-coverage loop for the third bookmarks-table constraint
    // (bookmarks_thumbnail_url_enc_size_cap). Same sanitisation contract.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: '23514',
        message:
          'new row for relation "bookmarks" violates check constraint "bookmarks_thumbnail_url_enc_size_cap"',
        details: 'Failing row contains (..., <oversized base64 blob>, ...).',
        hint: null,
      }),
    });

    const caught = await createBookmark(
      { title: TITLE, url: URL, thumbnailUrl: 'https://thumb.example.com/' },
      key,
      USER_ID,
    ).catch((e) => e) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe('Request failed (400)');
    expect(caught.message).not.toContain('bookmarks_thumbnail_url_enc_size_cap');
    expect(caught.message).not.toContain('relation "bookmarks"');
    expect(caught.message).not.toContain('check constraint');
    expect(caught.message).not.toContain('Failing row');
  });

  // -------------------------------------------------------------------------
  // updateBookmark — request method + URL
  // -------------------------------------------------------------------------
  it('updateBookmark sends a PATCH request', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: 'bm-abc' }] });

    await updateBookmark('bm-abc', { title: 'Updated', url: 'https://new.com' }, key);

    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });

  it('updateBookmark sends request to the correct filtered URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: 'bm-abc' }] });

    await updateBookmark('bm-abc', { title: 'Updated', url: 'https://new.com' }, key);

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/bookmarks?id=eq.bm-abc');
  });

  it('updateBookmark encrypts fields in the PATCH body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: 'bm-abc' }] });

    await updateBookmark('bm-abc', { title: 'Updated Title', url: 'https://new.com' }, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.title_enc).not.toBe('Updated Title');
    expect(body.url_enc).not.toBe('https://new.com');
  });

  it('updateBookmark throws when PostgREST returns empty array (bookmark not found or no RLS access)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await expect(
      updateBookmark('bm-missing', { title: 'T', url: 'https://x.com' }, key),
    ).rejects.toThrow('Bookmark not found or update failed');
  });

  // -------------------------------------------------------------------------
  // deleteBookmark
  // -------------------------------------------------------------------------
  it('deleteBookmark sends a DELETE request to the correct URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await deleteBookmark('bm-del');

    const url: string = fetchMock.mock.calls[0][0];
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(url).toContain('/bookmarks?id=eq.bm-del');
  });

  // -------------------------------------------------------------------------
  // thumbnailFileId support
  // -------------------------------------------------------------------------
  it('createBookmark sends thumbnail_file_id when provided', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark(
      { title: TITLE, url: URL, thumbnailFileId: 'img-uuid-1' },
      key,
      USER_ID,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thumbnail_file_id).toBe('img-uuid-1');
    // When file is used, URL field must be cleared
    expect(body.thumbnail_url_enc).toBeNull();
  });

  it('createBookmark sets thumbnail_file_id to null when not provided', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => bookmarkRow() });

    await createBookmark({ title: TITLE, url: URL }, key, USER_ID);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thumbnail_file_id).toBeNull();
  });

  it('updateBookmark sends thumbnail_file_id when provided', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: 'bm-abc' }] });

    await updateBookmark(
      'bm-abc',
      { title: 'T', url: 'https://x.com', thumbnailFileId: 'img-uuid-2' },
      key,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thumbnail_file_id).toBe('img-uuid-2');
    expect(body.thumbnail_url_enc).toBeNull();
  });

  it('getBookmarks decrypts thumbnailOriginalName when thumbnail_original_name_enc is present', async () => {
    const { encrypt } = await import('./crypto');
    const encName = await encrypt(key, 'photo.jpg');
    const encTitle = await encrypt(key, 'My Bookmark');
    const encUrl = await encrypt(key, 'https://example.com');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [makeRow({
        id: 'bm-1',
        title_enc: encTitle,
        url_enc: encUrl,
        thumbnail_file_id: 'img-1',
        thumbnail_original_name_enc: encName,
      })],
    });

    const { getBookmarks } = await import('./bookmarks');
    const bookmarks = await getBookmarks(key);

    expect(bookmarks[0].thumbnailFileId).toBe('img-1');
    expect(bookmarks[0].thumbnailOriginalName).toBe('photo.jpg');
  });

  // -------------------------------------------------------------------------
  // reencryptBookmark — PATCH body field contract
  // -------------------------------------------------------------------------
  it('reencryptBookmark does NOT include thumbnail_original_name_enc in the PATCH body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await reencryptBookmark(makeBookmark(), key, 2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('thumbnail_original_name_enc');
  });

  it('reencryptBookmark includes title_enc, url_enc, and thumbnail_url_enc in the PATCH body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await reencryptBookmark(makeBookmark(), key, 2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toHaveProperty('title_enc');
    expect(body).toHaveProperty('url_enc');
    expect(body).toHaveProperty('thumbnail_url_enc');
  });

  it('reencryptBookmark sends PATCH to the correct bookmark URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await reencryptBookmark(makeBookmark({ id: 'bm-42' }), key, 2);
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][0] as string).toContain('/bookmarks?id=eq.bm-42');
  });

  it('reencryptBookmark re-encrypts title so ciphertext differs from plaintext', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await reencryptBookmark(makeBookmark({ title: 'Secret Title' }), key, 2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.title_enc).not.toBe('Secret Title');
  });

  it('reencryptBookmark sets thumbnail_url_enc to null when thumbnailUrl is null', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await reencryptBookmark(makeBookmark({ thumbnailUrl: null }), key, 2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thumbnail_url_enc).toBeNull();
  });

  it('reencryptBookmark includes key_version: targetVersion in the PATCH body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await reencryptBookmark(makeBookmark(), key, 5);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.key_version).toBe(5);
  });

  // -------------------------------------------------------------------------
  // decryptBookmark — key_version mapping
  // -------------------------------------------------------------------------
  it('decryptBookmark maps key_version to keyVersion on the Bookmark', async () => {
    const row = makeRow({ key_version: 3 });
    // Use real encryption for title/url fields
    const { encrypt } = await import('./crypto');
    row.title_enc = await encrypt(key, 'Test');
    row.url_enc = await encrypt(key, 'https://test.com');

    const bm = await decryptBookmark(row, key);
    expect(bm.keyVersion).toBe(3);
  });

  it('decryptBookmark maps thumbnail_key_version to thumbnailKeyVersion', async () => {
    const { encrypt } = await import('./crypto');
    const row = makeRow({ thumbnail_key_version: 2 });
    row.title_enc = await encrypt(key, 'Test');
    row.url_enc = await encrypt(key, 'https://test.com');

    const bm = await decryptBookmark(row, key);
    expect(bm.thumbnailKeyVersion).toBe(2);
  });

  it('decryptBookmark sets thumbnailKeyVersion to null when thumbnail_key_version is null', async () => {
    const { encrypt } = await import('./crypto');
    const row = makeRow({ thumbnail_key_version: null });
    row.title_enc = await encrypt(key, 'Test');
    row.url_enc = await encrypt(key, 'https://test.com');

    const bm = await decryptBookmark(row, key);
    expect(bm.thumbnailKeyVersion).toBeNull();
  });

  // -------------------------------------------------------------------------
  // getBookmarkRows — raw fetch without decryption
  // -------------------------------------------------------------------------
  it('getBookmarkRows calls /bookmarks_with_tags with order=created_at.desc', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await getBookmarkRows();

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/bookmarks_with_tags');
    expect(url).toContain('order=created_at.desc');
  });

  it('getBookmarkRows returns raw rows without decryption', async () => {
    const rows = [makeRow({ id: 'bm-raw-1', title_enc: 'enc-title' })];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => rows });

    const result = await getBookmarkRows();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('bm-raw-1');
    expect(result[0].title_enc).toBe('enc-title');
  });

  it('getBookmarkRows returns empty array when API returns null', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const result = await getBookmarkRows();
    expect(result).toEqual([]);
  });

  it('getBookmarks sets thumbnailFileId and thumbnailOriginalName to null when absent', async () => {
    const { encrypt } = await import('./crypto');
    const encTitle = await encrypt(key, 'My Bookmark');
    const encUrl = await encrypt(key, 'https://example.com');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [makeRow({ id: 'bm-2', title_enc: encTitle, url_enc: encUrl })],
    });

    const { getBookmarks } = await import('./bookmarks');
    const bookmarks = await getBookmarks(key);

    expect(bookmarks[0].thumbnailFileId).toBeNull();
    expect(bookmarks[0].thumbnailOriginalName).toBeNull();
  });
});
