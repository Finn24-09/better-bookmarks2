import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getBookmarks, Bookmark } from '../../lib/bookmarks';
import { getTags, Tag } from '../../lib/tags';

const PAGE_SIZE = 20;

interface UseBookmarksResult {
  bookmarks: Bookmark[];
  tags: Tag[];
  isLoading: boolean;
  hasMore: boolean;
  isFiltered: boolean;
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
  const [hasMore, setHasMore] = useState(true);
  // Tracks whether we're in "paginated base" mode vs "fetch-all for search/filter"
  const [fetchedAll, setFetchedAll] = useState(false);

  const isFiltered = search.trim() !== '' || selectedTagId !== null;

  // Ref to cancel stale fetches when options change.
  const fetchIdRef = useRef(0);

  const loadTags = useCallback(async (key: CryptoKey) => {
    try {
      const t = await getTags(key);
      setTags(t);
    } catch {
      // non-fatal — tags remain empty
    }
  }, []);

  // Full reset + initial load.
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
        setAllBookmarks(bms);
        setOffset(fetchAll ? bms.length : PAGE_SIZE);
        setHasMore(fetchAll ? false : bms.length === PAGE_SIZE);
        setFetchedAll(fetchAll);
      } catch {
        // leave previous data in place
      } finally {
        if (id === fetchIdRef.current) setIsLoading(false);
      }
    },
    [loadTags],
  );

  // Re-run when search/filter mode changes.
  useEffect(() => {
    if (!cryptoKey) return;
    // When switching from filtered → unfiltered we always re-fetch from scratch.
    // When switching to filtered → fetch all so client-side filtering works.
    if (isFiltered && !fetchedAll) {
      load(cryptoKey, true);
    } else if (!isFiltered && fetchedAll) {
      load(cryptoKey, false);
    } else if (!fetchedAll && allBookmarks.length === 0) {
      load(cryptoKey, false);
    }
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
      setAllBookmarks((prev) => [...prev, ...more]);
      setOffset((o) => o + more.length);
      setHasMore(more.length === PAGE_SIZE);
    } catch {
      // leave state as-is
    } finally {
      setIsLoading(false);
    }
  }, [cryptoKey, isLoading, hasMore, isFiltered, offset]);

  // Client-side filtering (search + tag).
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

  return { bookmarks, tags, isLoading, hasMore, isFiltered, loadMore, refresh };
}
