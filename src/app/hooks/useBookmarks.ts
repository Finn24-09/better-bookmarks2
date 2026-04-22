import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getBookmarks, Bookmark } from '../../lib/bookmarks';
import { getTags, Tag } from '../../lib/tags';
import { fetchThumbnailObjectUrl } from '../../lib/thumbnails';

const PAGE_SIZE = 20;

interface UseBookmarksResult {
  bookmarks: Bookmark[];
  tags: Tag[];
  isLoading: boolean;
  hasMore: boolean;
  isFiltered: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}

interface UseBookmarksOptions {
  search: string;
  selectedTagId: string | null;
}

export function useBookmarks({ search, selectedTagId }: UseBookmarksOptions): UseBookmarksResult {
  const { cryptoKey } = useAuth();

  const [allBookmarks, setAllBookmarks] = useState<Bookmark[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [fetchedAll, setFetchedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFiltered = search.trim() !== '' || selectedTagId !== null;

  const fetchIdRef = useRef(0);
  const thumbCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const cache = thumbCache.current;
    return () => cache.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const resolveThumbnails = useCallback(
    async (bms: Bookmark[], key: CryptoKey): Promise<Bookmark[]> => {
      return Promise.all(
        bms.map(async (bm) => {
          if (!bm.thumbnailFileId) return bm;
          if (!thumbCache.current.has(bm.thumbnailFileId)) {
            const url = await fetchThumbnailObjectUrl(bm.thumbnailFileId, key);
            thumbCache.current.set(bm.thumbnailFileId, url);
          }
          return { ...bm, thumbnailUrl: thumbCache.current.get(bm.thumbnailFileId)! };
        }),
      );
    },
    [],
  );

  const loadTags = useCallback(async (key: CryptoKey) => {
    try {
      const t = await getTags(key);
      setTags(t);
    } catch {
      // non-fatal — tags remain empty
    }
  }, []);

  const load = useCallback(
    async (key: CryptoKey, fetchAll: boolean) => {
      const id = ++fetchIdRef.current;
      setIsLoading(true);
      try {
        const [bms] = await Promise.all([
          fetchAll
            ? getBookmarks(key)
            : getBookmarks(key, { limit: PAGE_SIZE, offset: 0 }),
          loadTags(key),
        ]);
        if (id !== fetchIdRef.current) return; // stale
        setError(null);
        const resolved = await resolveThumbnails(bms, key);
        if (id !== fetchIdRef.current) return; // stale after thumbnail fetch
        setAllBookmarks(resolved);
        setOffset(fetchAll ? resolved.length : PAGE_SIZE);
        setHasMore(fetchAll ? false : resolved.length === PAGE_SIZE);
        setFetchedAll(fetchAll);
      } catch (e) {
        if (import.meta.env.DEV) console.error('[useBookmarks] load failed:', e);
        if (id === fetchIdRef.current) {
          setError(e instanceof Error ? e.message : 'Failed to load bookmarks');
          setHasMore(false);
        }
      } finally {
        if (id === fetchIdRef.current) setIsLoading(false);
      }
    },
    [loadTags, resolveThumbnails],
  );

  useEffect(() => {
    if (!cryptoKey) return;
    load(cryptoKey, isFiltered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoKey, isFiltered]);

  const refresh = useCallback(() => {
    if (!cryptoKey) return;
    load(cryptoKey, isFiltered);
  }, [cryptoKey, isFiltered, load]);

  const loadMore = useCallback(async () => {
    if (!cryptoKey || isLoading || !hasMore || isFiltered) return;
    setIsLoading(true);
    try {
      const more = await getBookmarks(cryptoKey, { limit: PAGE_SIZE, offset });
      const resolved = await resolveThumbnails(more, cryptoKey);
      setAllBookmarks((prev) => [...prev, ...resolved]);
      setOffset((o) => o + resolved.length);
      setHasMore(resolved.length === PAGE_SIZE);
    } catch {
      // leave state as-is
    } finally {
      setIsLoading(false);
    }
  }, [cryptoKey, isLoading, hasMore, isFiltered, offset, resolveThumbnails]);

  const bookmarks = isFiltered
    ? allBookmarks.filter((b) => {
        const q = search.trim().toLowerCase();
        const matchesSearch =
          q === '' || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q);
        const matchesTag =
          selectedTagId === null || b.tagIds.includes(selectedTagId);
        return matchesSearch && matchesTag;
      })
    : allBookmarks;

  return { bookmarks, tags, isLoading, hasMore, isFiltered, error, loadMore, refresh };
}
