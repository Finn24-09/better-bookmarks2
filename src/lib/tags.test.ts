import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTags, createTag, setBookmarkTags, reencryptTag, getTagRows, updateTag, MAX_TAG_LENGTH } from './tags';
import { deriveKey, decrypt, computeHmac } from './crypto';
import { setAuthToken, ApiError } from './api';

const USER_ID = 'user-uuid-123';

function tagRow(id = 'tag-1') {
  return [{ id, user_id: USER_ID, name_enc: 'x', name_hmac: 'y', created_at: '', key_version: 1 }];
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

  it('createTag returns keyVersion from the server representation row (CR-001)', async () => {
    // Server returns the new tag with key_version set (PostgREST default 1, or rotated value).
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{
        id: 'tag-kv',
        user_id: USER_ID,
        name_enc: 'x',
        name_hmac: 'y',
        created_at: '',
        key_version: 7,
      }],
    });

    const tag = await createTag('work', USER_ID, key);
    // Strict equality on the number, not shape equality — the bug class
    // is "keyVersion is undefined-but-typed-as-number".
    expect(tag.keyVersion).toBe(7);
  });

  it('createTag falls back to keyVersion 1 if server omits key_version', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => [{
        id: 'tag-default',
        user_id: USER_ID,
        name_enc: 'x',
        name_hmac: 'y',
        created_at: '',
        // key_version omitted
      }],
    });

    const tag = await createTag('work', USER_ID, key);
    expect(tag.keyVersion).toBe(1);
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
  // getTags — null guard (F-3) and key_version mapping
  // -------------------------------------------------------------------------
  it('getTags returns empty array when apiFetch returns undefined (e.g. 204 response)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const result = await getTags(key);
    expect(result).toEqual([]);
  });

  it('getTags maps key_version to keyVersion on returned tags', async () => {
    const { encrypt } = await import('./crypto');
    const encName = await encrypt(key, 'work');

    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => [{ id: 'tag-1', user_id: USER_ID, name_enc: encName, name_hmac: 'h', created_at: '', key_version: 3 }],
    });

    const tags = await getTags(key);
    expect(tags[0].keyVersion).toBe(3);
  });

  // -------------------------------------------------------------------------
  // reencryptTag — key_version in PATCH body
  // -------------------------------------------------------------------------
  it('reencryptTag includes key_version: targetVersion in the PATCH body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await reencryptTag('tag-1', 'work', key, 5);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.key_version).toBe(5);
  });

  it('reencryptTag sends PATCH to the correct tag URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await reencryptTag('tag-abc', 'work', key, 2);

    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][0] as string).toContain('/tags?id=eq.tag-abc');
  });

  // -------------------------------------------------------------------------
  // getTagRows — raw fetch without decryption
  // -------------------------------------------------------------------------
  it('getTagRows calls /tags with order=created_at.asc', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await getTagRows();

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/tags');
    expect(url).toContain('order=created_at.asc');
  });

  it('getTagRows returns raw rows without decryption', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => [{ id: 'tag-1', user_id: USER_ID, name_enc: 'enc-name', name_hmac: 'h', created_at: '', key_version: 1 }],
    });

    const result = await getTagRows();
    expect(result).toHaveLength(1);
    expect(result[0].name_enc).toBe('enc-name');
  });

  it('getTagRows returns empty array when API returns null', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const result = await getTagRows();
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // MAX_TAG_LENGTH constant
  // -------------------------------------------------------------------------
  it('exports MAX_TAG_LENGTH = 100 (matches importJson cap)', () => {
    expect(MAX_TAG_LENGTH).toBe(100);
  });

  // -------------------------------------------------------------------------
  // createTag — trim fix
  // -------------------------------------------------------------------------
  it('createTag trims whitespace before encrypt + HMAC so padded duplicates collide', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('  Personal  ', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decrypted = await decrypt(key, body.name_enc);
    expect(decrypted).toBe('Personal');

    const expectedHmac = await computeHmac(USER_ID, 'Personal');
    expect(body.name_hmac).toBe(expectedHmac);
  });

  it('createTag with same plaintext but different userId produces different HMACs (multi-user dedup)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('shared', 'user-a', key);
    const bodyA = JSON.parse(fetchMock.mock.calls[0][1].body);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => tagRow() });

    await createTag('shared', 'user-b', key);
    const bodyB = JSON.parse(fetchMock.mock.calls[0][1].body);

    expect(bodyA.name_hmac).not.toBe(bodyB.name_hmac);
  });

  // -------------------------------------------------------------------------
  // updateTag — request shape and security invariants
  // -------------------------------------------------------------------------
  it('updateTag PATCHes /tags?id=eq.{id} with method PATCH', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-abc', 'Renamed', USER_ID, key);

    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][0] as string).toContain('/tags?id=eq.tag-abc');
  });

  it('updateTag body contains ONLY name_enc and name_hmac', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-1', 'Renamed', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['name_enc', 'name_hmac']);
  });

  it('updateTag does NOT include user_id in PATCH body (RLS enforces ownership)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-1', 'Renamed', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.user_id).toBeUndefined();
  });

  it('updateTag does NOT include key_version in PATCH body (encryption key unchanged on rename)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-1', 'Renamed', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.key_version).toBeUndefined();
  });

  it('updateTag re-encrypts the new name (name_enc decrypts back to the new value)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-1', 'Renamed', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decrypted = await decrypt(key, body.name_enc);
    expect(decrypted).toBe('Renamed');
  });

  it('updateTag re-HMACs the new name with the userId', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-1', 'Renamed', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const expectedHmac = await computeHmac(USER_ID, 'Renamed');
    expect(body.name_hmac).toBe(expectedHmac);
  });

  it('updateTag operates on the trimmed value (whitespace-padded matches unpadded HMAC)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

    await updateTag('tag-1', '  Personal  ', USER_ID, key);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const decrypted = await decrypt(key, body.name_enc);
    expect(decrypted).toBe('Personal');

    const expectedHmac = await computeHmac(USER_ID, 'Personal');
    expect(body.name_hmac).toBe(expectedHmac);
  });

  // -------------------------------------------------------------------------
  // updateTag — server rejects oversized name_enc (issue #23)
  // -------------------------------------------------------------------------
  it('updateTag surfaces a sanitised ApiError when the server rejects an oversized name_enc with 400', async () => {
    // Simulate the response PostgREST returns when tags_name_enc_size_cap
    // (added in docker/db/init/12_encrypted_column_size_caps.sql) blocks an
    // oversized PATCH. The constraint name and table name appear in the body —
    // they MUST NOT reach the caller, which would otherwise show them in a
    // sonner toast via err.message.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: '23514',
        message:
          'new row for relation "tags" violates check constraint "tags_name_enc_size_cap"',
        details: 'Failing row contains (..., <oversized base64 blob>, ...).',
        hint: null,
      }),
    });

    const caught = await updateTag('tag-1', 'Renamed', USER_ID, key).catch((e) => e) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe('Request failed (400)');
    expect(caught.message).not.toContain('tags_name_enc_size_cap');
    expect(caught.message).not.toContain('relation "tags"');
    expect(caught.message).not.toContain('check constraint');
    expect(caught.message).not.toContain('Failing row');
  });

  // -------------------------------------------------------------------------
  // createTag — server rejects oversized name_enc (issue #23)
  // -------------------------------------------------------------------------
  it('createTag surfaces a sanitised ApiError when the server rejects an oversized name_enc with 400', async () => {
    // Same shape as the updateTag sanitisation test above and the
    // createBookmark one in bookmarks.test.ts -- locks the contract that
    // tags_name_enc_size_cap rejection messages don't leak the constraint
    // name or table name through the createTag call site either.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        code: '23514',
        message:
          'new row for relation "tags" violates check constraint "tags_name_enc_size_cap"',
        details: 'Failing row contains (..., <oversized base64 blob>, ...).',
        hint: null,
      }),
    });

    const caught = await createTag('work', USER_ID, key).catch((e) => e) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe('Request failed (400)');
    expect(caught.message).not.toContain('tags_name_enc_size_cap');
    expect(caught.message).not.toContain('relation "tags"');
    expect(caught.message).not.toContain('check constraint');
    expect(caught.message).not.toContain('Failing row');
  });
});
