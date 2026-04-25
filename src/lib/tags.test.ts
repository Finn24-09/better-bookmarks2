import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTags, createTag, setBookmarkTags } from './tags';
import { deriveKey, decrypt, computeHmac } from './crypto';
import { setAuthToken } from './api';

const USER_ID = 'user-uuid-123';

function tagRow(id = 'tag-1') {
  return [{ id, user_id: USER_ID, name_enc: 'x', name_hmac: 'y', created_at: '' }];
}

describe('tags', () => {
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
  // createTag — request body
  // -------------------------------------------------------------------------
  it('createTag includes user_id in POST body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('work', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.user_id).toBe(USER_ID);
  });

  it('createTag sends encrypted name_enc (not plaintext)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('work', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.name_enc).toBeTruthy();
    expect(body.name_enc).not.toBe('work');
  });

  it('createTag name_enc decrypts back to the original name', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('work', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decrypted = await decrypt(key, body.name_enc);
    expect(decrypted).toBe('work');
  });

  it('createTag sends name_hmac that matches computeHmac(userId, name)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('work', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const expectedHmac = await computeHmac(USER_ID, 'work');
    expect(body.name_hmac).toBe(expectedHmac);
  });

  it('createTag returns the id and decrypted name', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow('tag-abc') });

    const tag = await createTag('design', USER_ID, key);
    expect(tag.id).toBe('tag-abc');
    expect(tag.name).toBe('design');
  });

  // -------------------------------------------------------------------------
  // setBookmarkTags — diff logic
  // -------------------------------------------------------------------------
  it('setBookmarkTags sends Prefer: resolution=ignore-duplicates on POST to make inserts idempotent', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await setBookmarkTags('bm-1', ['tag-a'], []);

    const post = fetchMock.mock.calls.find(([, o]) => o.method === 'POST');
    expect(post).toBeDefined();
    const headers = post![1].headers as Record<string, string>;
    expect(headers['Prefer']).toContain('resolution=ignore-duplicates');
  });

  it('setBookmarkTags POSTs only the tags that were added', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    // current: [b, c] → new: [a, b]  ⇒  add: a, remove: c
    await setBookmarkTags('bm-1', ['tag-a', 'tag-b'], ['tag-b', 'tag-c']);

    const posts = fetchMock.mock.calls.filter(([, o]) => o.method === 'POST');
    expect(posts).toHaveLength(1);
    const postBody = JSON.parse(posts[0][1].body);
    expect(postBody).toMatchObject({ bookmark_id: 'bm-1', tag_id: 'tag-a' });
  });

  it('setBookmarkTags DELETEs only the tags that were removed', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await setBookmarkTags('bm-1', ['tag-a', 'tag-b'], ['tag-b', 'tag-c']);

    const deletes = fetchMock.mock.calls.filter(([, o]) => o.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    const deleteUrl: string = deletes[0][0];
    expect(deleteUrl).toContain('tag-c');
  });

  it('setBookmarkTags does not touch tags that are unchanged', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    // tag-b is in both old and new — should not be touched
    await setBookmarkTags('bm-1', ['tag-a', 'tag-b'], ['tag-b', 'tag-c']);

    const allUrls: string[] = fetchMock.mock.calls.map(([url]) => url);
    const touchedTagB = allUrls.some((u) => u.includes('tag-b'));
    expect(touchedTagB).toBe(false);
  });

  it('setBookmarkTags makes no requests when tags are unchanged', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await setBookmarkTags('bm-1', ['tag-a', 'tag-b'], ['tag-a', 'tag-b']);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // getTags — null guard (F-3)
  // -------------------------------------------------------------------------
  it('getTags returns empty array when apiFetch returns undefined (e.g. 204 response)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const result = await getTags(key);
    expect(result).toEqual([]);
  });
});
