import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getBookmarks, Bookmark } from '../../lib/bookmarks';
import { getTags, Tag } from '../../lib/tags';
import { fetchThumbnailObjectUrl } from '../../lib/thumbnails';
import { runWithConcurrency } from '../../lib/utils';

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
  const [error, setError] = useState<string | null>(null);

  const isFiltered = search.trim() !== '' || selectedTagId !== null;

  const fetchIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const thumbCache = useRef<Map<string, string>>(new Map());
  // Maps bookmarkId → thumbnailFileId to detect replaced thumbnails and revoke stale blob URLs.
  const bookmarkFileIdRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const cache = thumbCache.current;
    return () => cache.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const resolveThumbnails = useCallback(
    async (bms: Bookmark[], key: CryptoKey): Promise<Bookmark[]> => {
      const results = [...bms];
      await runWithConcurrency(
        bms.map((bm, i) => ({ bm, i })),
        async ({ bm, i }) => {
          if (!bm.thumbnailFileId) return;

          // Revoke stale blob URL if the bookmark's thumbnail was replaced.
          const prevFileId = bookmarkFileIdRef.current.get(bm.id);
          if (prevFileId && prevFileId !== bm.thumbnailFileId) {
            const staleUrl = thumbCache.current.get(prevFileId);
            if (staleUrl) URL.revokeObjectURL(staleUrl);
            thumbCache.current.delete(prevFileId);
          }
          bookmarkFileIdRef.current.set(bm.id, bm.thumbnailFileId);

          if (!thumbCache.current.has(bm.thumbnailFileId)) {
            const url = await fetchThumbnailObjectUrl(bm.thumbnailFileId, key);
            thumbCache.current.set(bm.thumbnailFileId, url);
          }
          results[i] = { ...bm, thumbnailUrl: thumbCache.current.get(bm.thumbnailFileId)! };
        },
        3,
      );
      return results;
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
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const id = ++fetchIdRef.current;
      setIsLoading(true);
      try {
        const [page] = await Promise.all([
          fetchAll
            ? getBookmarks(key, { signal: controller.signal })
            : getBookmarks(key, { limit: PAGE_SIZE + 1, offset: 0, signal: controller.signal }),
          loadTags(key),
        ]);
        if (id !== fetchIdRef.current) return; // stale
        const bms = fetchAll ? page : page.slice(0, PAGE_SIZE);
        const hasMoreFromPage = fetchAll ? false : page.length > PAGE_SIZE;
        setError(null);
        const resolved = await resolveThumbnails(bms, key);
        if (id !== fetchIdRef.current) return; // stale after thumbnail fetch
        setAllBookmarks(resolved);
        setOffset(fetchAll ? resolved.length : PAGE_SIZE);
        setHasMore(hasMoreFromPage);
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
      const page = await getBookmarks(cryptoKey, { limit: PAGE_SIZE + 1, offset });
      const more = page.slice(0, PAGE_SIZE);
      const resolved = await resolveThumbnails(more, cryptoKey);
      setAllBookmarks((prev) => [...prev, ...resolved]);
      setOffset((o) => o + resolved.length);
      setHasMore(page.length > PAGE_SIZE);
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
