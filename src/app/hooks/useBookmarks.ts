import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getBookmarks, Bookmark } from '../../lib/bookmarks';
import { getTags, Tag } from '../../lib/tags';
import { fetchThumbnailObjectUrl } from '../../lib/thumbnails';
import { runWithConcurrency, withRetry } from '../../lib/utils';

const PAGE_SIZE = 20;

// Thumbnail reads share Nginx's api_read limit_req zone with the bookmark list
// itself, so a 429 on one card's image is routine rather than exceptional.
//
// Exactly one retry, deliberately: a thumbnail is decorative, the grid waits on
// these before rendering, and every retry spends budget the *list* request also
// needs. One attempt rides out a transient rejection; beyond that the card just
// shows its placeholder.
const THUMB_RETRY_ATTEMPTS = 2;
const THUMB_RETRY_BASE_MS = 600;

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
            try {
              const url = await withRetry(
                () => fetchThumbnailObjectUrl(bm.thumbnailFileId!, key),
                { attempts: THUMB_RETRY_ATTEMPTS, baseMs: THUMB_RETRY_BASE_MS },
              );
              thumbCache.current.set(bm.thumbnailFileId, url);
            } catch {
              // Leave this card without an image — BookmarkCard falls back to
              // its placeholder. Letting the error escape rejected the whole
              // load() and replaced every bookmark with an error message, so a
              // single rate-limited image emptied the entire grid.
              return;
            }
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
  }, [cryptoKey, isFiltered, load]);

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
    } catch (e) {
      // Stop the IntersectionObserver from retrying forever (CR-010).
      setHasMore(false);
      setError(e instanceof Error ? e.message : 'Failed to load more bookmarks');
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
