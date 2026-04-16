import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBookmark, updateBookmark, deleteBookmark } from './bookmarks';
import { deriveKey, decrypt } from './crypto';
import { setAuthToken } from './api';

const USER_ID = 'user-uuid-123';
const TITLE = 'My Bookmark';
const URL = 'https://example.com';

// Minimal bookmark row for POST response
function bookmarkRow(id = 'bm-1') {
  return [{
    id,
    user_id: USER_ID,
    title_enc: 'x',
    url_enc: 'x',
    thumbnail_url_enc: null,
    thumbnail_file_id: null,
    thumbnail_original_name_enc: null,
    created_at: '',
    updated_at: '',
    tag_ids: [],
  }];
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
  // updateBookmark — request method + URL
  // -------------------------------------------------------------------------
  it('updateBookmark sends a PATCH request', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateBookmark('bm-abc', { title: 'Updated', url: 'https://new.com' }, key);

    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });

  it('updateBookmark sends request to the correct filtered URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateBookmark('bm-abc', { title: 'Updated', url: 'https://new.com' }, key);

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/bookmarks?id=eq.bm-abc');
  });

  it('updateBookmark encrypts fields in the PATCH body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateBookmark('bm-abc', { title: 'Updated Title', url: 'https://new.com' }, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.title_enc).not.toBe('Updated Title');
    expect(body.url_enc).not.toBe('https://new.com');
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
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

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
      json: async () => [{
        id: 'bm-1',
        user_id: USER_ID,
        title_enc: encTitle,
        url_enc: encUrl,
        thumbnail_url_enc: null,
        thumbnail_file_id: 'img-1',
        thumbnail_original_name_enc: encName,
        created_at: '',
        updated_at: '',
        tag_ids: [],
      }],
    });

    const { getBookmarks } = await import('./bookmarks');
    const bookmarks = await getBookmarks(key);

    expect(bookmarks[0].thumbnailFileId).toBe('img-1');
    expect(bookmarks[0].thumbnailOriginalName).toBe('photo.jpg');
  });

  it('getBookmarks sets thumbnailFileId and thumbnailOriginalName to null when absent', async () => {
    const { encrypt } = await import('./crypto');
    const encTitle = await encrypt(key, 'My Bookmark');
    const encUrl = await encrypt(key, 'https://example.com');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{
        id: 'bm-2',
        user_id: USER_ID,
        title_enc: encTitle,
        url_enc: encUrl,
        thumbnail_url_enc: null,
        thumbnail_file_id: null,
        thumbnail_original_name_enc: null,
        created_at: '',
        updated_at: '',
        tag_ids: [],
      }],
    });

    const { getBookmarks } = await import('./bookmarks');
    const bookmarks = await getBookmarks(key);

    expect(bookmarks[0].thumbnailFileId).toBeNull();
    expect(bookmarks[0].thumbnailOriginalName).toBeNull();
  });
});
