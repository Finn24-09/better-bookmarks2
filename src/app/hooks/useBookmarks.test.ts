import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBookmarks } from './useBookmarks';
import type { Bookmark } from '../../lib/bookmarks';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockCryptoKey = {} as CryptoKey;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ cryptoKey: mockCryptoKey }),
}));

vi.mock('../../lib/bookmarks', () => ({
  getBookmarks: vi.fn(),
}));

vi.mock('../../lib/tags', () => ({
  getTags: vi.fn(),
}));

vi.mock('../../lib/thumbnails', () => ({
  fetchThumbnailObjectUrl: vi.fn(),
}));

// Import the mocked functions so we can configure them per-test.
import { getBookmarks } from '../../lib/bookmarks';
import { getTags } from '../../lib/tags';
import { fetchThumbnailObjectUrl } from '../../lib/thumbnails';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBookmarks(count: number, idOffset = 0): Bookmark[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bm-${idOffset + i}`,
    title: `Bookmark ${idOffset + i}`,
    url: `https://example.com/${idOffset + i}`,
    thumbnailUrl: null,
    thumbnailFileId: null,
    thumbnailOriginalName: null,
    tagIds: [],
    createdAt: '',
    updatedAt: '',
    keyVersion: 1,
    thumbnailKeyVersion: null,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTags).mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // Paginated base mode (no search/filter)
  // -------------------------------------------------------------------------
  it('initial fetch uses limit=21 (PAGE_SIZE+1) to detect whether more pages exist', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(21));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getBookmarks).toHaveBeenCalledWith(
      mockCryptoKey,
      expect.objectContaining({ limit: 21, offset: 0 }),
    );
  });

  it('hasMore is true when PAGE_SIZE+1 items are returned (extra item confirms more exist)', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(21));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(true);
    // Only PAGE_SIZE items should be displayed, not the extra probe item
    expect(result.current.bookmarks).toHaveLength(20);
  });

  it('hasMore is false when exactly PAGE_SIZE items are returned (no extra item)', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(20));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it('hasMore is false when the page is not full (< 20 items)', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(7));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it('loadMore fetches next page with offset=20 and appends results', async () => {
    vi.mocked(getBookmarks)
      .mockResolvedValueOnce(makeBookmarks(21))       // initial: 21 items → hasMore=true, display 20
      .mockResolvedValueOnce(makeBookmarks(5, 20));   // second page: 5 items → hasMore=false

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getBookmarks).toHaveBeenCalledWith(
      mockCryptoKey,
      expect.objectContaining({ limit: 21, offset: 20 }),
    );
    expect(result.current.bookmarks).toHaveLength(25);
  });

  it('hasMore is false after loadMore returns a partial page', async () => {
    vi.mocked(getBookmarks)
      .mockResolvedValueOnce(makeBookmarks(21))
      .mockResolvedValueOnce(makeBookmarks(3, 20));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasMore).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Filtered mode (search or tag)
  // -------------------------------------------------------------------------
  it('when search is active, fetches all bookmarks without limit/offset (pagination disabled)', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(3));

    const { result } = renderHook(() =>
      useBookmarks({ search: 'hello', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // fetchAll=true → no limit/offset; only a signal is passed for abort support
    const call = vi.mocked(getBookmarks).mock.calls[0];
    expect(call[1]).not.toHaveProperty('limit');
    expect(call[1]).not.toHaveProperty('offset');
  });

  it('when search is active, hasMore is always false', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(20));

    const { result } = renderHook(() =>
      useBookmarks({ search: 'hello', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it('search filters bookmarks by title (case-insensitive)', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([
      { id: 'bm-1', title: 'Hello World', url: 'https://a.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
      { id: 'bm-2', title: 'Other Bookmark', url: 'https://b.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
    ]);

    const { result } = renderHook(() =>
      useBookmarks({ search: 'hello', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].id).toBe('bm-1');
  });

  it('search filters bookmarks by URL as well', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([
      { id: 'bm-1', title: 'A Page', url: 'https://github.com/foo', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
      { id: 'bm-2', title: 'B Page', url: 'https://example.com/bar', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
    ]);

    const { result } = renderHook(() =>
      useBookmarks({ search: 'github', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].id).toBe('bm-1');
  });

  it('tag filter narrows results to bookmarks that have the selected tag', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([
      { id: 'bm-1', title: 'A', url: 'https://a.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: ['tag-1'], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
      { id: 'bm-2', title: 'B', url: 'https://b.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: ['tag-2'], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
    ]);

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: 'tag-1' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].id).toBe('bm-1');
  });

  it('search and tag filter compose with AND logic', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([
      { id: 'bm-1', title: 'Hello', url: 'https://a.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: ['tag-1'], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
      { id: 'bm-2', title: 'Hello', url: 'https://b.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: ['tag-2'], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
      { id: 'bm-3', title: 'Other', url: 'https://c.com', thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null, tagIds: ['tag-1'], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null },
    ]);

    const { result } = renderHook(() =>
      useBookmarks({ search: 'hello', selectedTagId: 'tag-1' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Only bm-1 matches both conditions
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].id).toBe('bm-1');
  });

  it('isFiltered is true when search is non-empty', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBookmarks({ search: 'x', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isFiltered).toBe(true);
  });

  it('isFiltered is true when a tag is selected', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: 'tag-1' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isFiltered).toBe(true);
  });

  it('isFiltered is false when search is empty and no tag selected', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isFiltered).toBe(false);
  });

  // -------------------------------------------------------------------------
  // File thumbnail resolution
  // -------------------------------------------------------------------------
  it('resolves thumbnailFileId to a blob URL via fetchThumbnailObjectUrl', async () => {
    vi.mocked(getBookmarks).mockResolvedValue([
      {
        id: 'bm-1', title: 'T', url: 'https://a.com',
        thumbnailUrl: null, thumbnailFileId: 'img-1', thumbnailOriginalName: 'photo.jpg',
        tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null,
      },
    ]);
    vi.mocked(fetchThumbnailObjectUrl).mockResolvedValue('blob:fake-url-1');

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchThumbnailObjectUrl).toHaveBeenCalledWith('img-1', mockCryptoKey);
    expect(result.current.bookmarks[0].thumbnailUrl).toBe('blob:fake-url-1');
  });

  it('caches blob URLs so fetchThumbnailObjectUrl is not called twice for the same fileId', async () => {
    const bm = {
      id: 'bm-1', title: 'T', url: 'https://a.com',
      thumbnailUrl: null, thumbnailFileId: 'img-1', thumbnailOriginalName: null,
      tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null,
    };
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    vi.mocked(fetchThumbnailObjectUrl).mockResolvedValue('blob:cached-url');

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Trigger refresh — same fileId should not re-fetch
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchThumbnailObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('leaves thumbnailUrl as null for bookmarks without thumbnailFileId', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(1));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchThumbnailObjectUrl).not.toHaveBeenCalled();
    expect(result.current.bookmarks[0].thumbnailUrl).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Failure resilience — prevents infinite IntersectionObserver loop
  // -------------------------------------------------------------------------
  it('hasMore stays false when the initial load fails', async () => {
    // If load() throws silently and hasMore stayed true, the IntersectionObserver
    // would call loadMore() in an infinite loop every time isLoading toggles.
    vi.mocked(getBookmarks).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  it('hasMore stays false when the initial load fails mid-decrypt', async () => {
    // Simulate decryption failure (wrong key) — the kind that occurs when
    // account data is encrypted with a different user's key.
    vi.mocked(getBookmarks).mockRejectedValue(
      new DOMException('The operation failed for an operation-specific reason', 'OperationError'),
    );

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------
  it('sets error when getBookmarks throws', async () => {
    vi.mocked(getBookmarks).mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('network error');
    expect(result.current.bookmarks).toHaveLength(0);
  });

  it('clears error on successful refresh after a failure', async () => {
    vi.mocked(getBookmarks)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(makeBookmarks(3));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('network error');

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.bookmarks).toHaveLength(3);
  });

  it('error is null on successful initial load', async () => {
    vi.mocked(getBookmarks).mockResolvedValue(makeBookmarks(5));

    const { result } = renderHook(() =>
      useBookmarks({ search: '', selectedTagId: null }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
