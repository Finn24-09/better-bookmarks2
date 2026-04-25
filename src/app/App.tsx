import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Bookmark as BookmarkIcon, Upload } from "lucide-react";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { TagFilter } from "./components/TagFilter";
import { BookmarkCard } from "./components/BookmarkCard";
import { FloatingFooter } from "./components/FloatingFooter";
import { AddBookmarkButton } from "./components/AddBookmarkButton";
import { BookmarkFormModal } from "./components/BookmarkFormModal";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { DeleteAccountModal } from "./components/DeleteAccountModal";
import { ImportBookmarksModal } from "./components/ImportBookmarksModal";
import { ExportBookmarksModal } from "./components/ExportBookmarksModal";
import { useBookmarks } from "./hooks/useBookmarks";
import type { Bookmark } from "../lib/bookmarks";

export default function App() {
  // --------------------------------------------------------------------------
  // Lifted search/filter state (Phase 4)
  // --------------------------------------------------------------------------
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  // Debounce search by 300ms to avoid a full reload on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // --------------------------------------------------------------------------
  // Data
  // --------------------------------------------------------------------------
  const { bookmarks, tags, isLoading, hasMore, isFiltered, error, loadMore, refresh } =
    useBookmarks({ search: debouncedSearch, selectedTagId });

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // --------------------------------------------------------------------------
  // Modals
  // --------------------------------------------------------------------------
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const handleOpenAdd = () => {
    setEditingBookmark(null);
    setModalOpen(true);
  };
  const handleOpenEdit = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
    setModalOpen(true);
  };

  // --------------------------------------------------------------------------
  // Infinite scroll sentinel (Phase 4)
  // --------------------------------------------------------------------------
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !isLoading && !isFiltered) {
        loadMore();
      }
    },
    [hasMore, isLoading, isFiltered, loadMore],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleIntersect, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect]);

  // --------------------------------------------------------------------------
  // Tag name lookup (for BookmarkCard display)
  // --------------------------------------------------------------------------
  const tagNameById = Object.fromEntries(tags.map((t) => [t.id, t.name]));

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-purple-950 to-slate-950">
      <Header
        onChangePassword={() => setChangePasswordOpen(true)}
        onDeleteAccount={() => setDeleteAccountOpen(true)}
        onImportBookmarks={() => setImportOpen(true)}
        onExportBookmarks={() => setExportOpen(true)}
      />

        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 px-4 md:px-6 lg:px-8 pt-6 md:pt-8 pb-8">

          {/* Search and Filters */}
          <div className="space-y-4">
            <SearchBar value={search} onChange={setSearch} />
            <TagFilter tags={tags} selected={selectedTagId} onSelect={setSelectedTagId} />
          </div>

          {/* Bookmarks Grid */}
          {bookmarks.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              {isFiltered ? (
                <p className="text-white/40 text-lg">No bookmarks match your search.</p>
              ) : (
                <div className="flex flex-col items-center gap-6">
                  <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-full flex items-center justify-center">
                    <BookmarkIcon className="w-9 h-9 text-white/30" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-white/70">Welcome to Better Bookmarks</h2>
                    <p className="text-white/40 text-sm max-w-xs mx-auto">
                      Save, organise, and revisit your favourite links — all end-to-end encrypted.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <button
                      onClick={() => setImportOpen(true)}
                      className="flex items-center gap-2 px-5 py-2.5 bg-linear-to-br from-purple-600 to-purple-800 text-white rounded-full text-sm shadow-lg shadow-purple-500/30 hover:scale-105 active:scale-95 transition-all duration-300"
                    >
                      <Upload className="w-4 h-4" />
                      Import CSV or JSON
                    </button>
                    <span className="text-white/30 text-sm">or use the + button to add one</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {bookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  thumbnail={bookmark.thumbnailUrl}
                  title={bookmark.title}
                  url={bookmark.url}
                  tags={bookmark.tagIds.map((id) => tagNameById[id]).filter(Boolean)}
                  onEdit={() => handleOpenEdit(bookmark)}
                />
              ))}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
        </div>

      {/* Add Bookmark FAB */}
      <div
        className="fixed bottom-20 left-0 right-0 z-40 pointer-events-none"
        style={{ paddingRight: "var(--removed-body-scroll-bar-size, 0px)" }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex justify-end">
            <div className="pointer-events-auto">
              <AddBookmarkButton onClick={handleOpenAdd} />
            </div>
          </div>
        </div>
      </div>

      <FloatingFooter />

      {/* Add / Edit Bookmark Modal */}
      <BookmarkFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialData={
          editingBookmark
            ? {
                id: editingBookmark.id,
                title: editingBookmark.title,
                url: editingBookmark.url,
                thumbnailUrl: editingBookmark.thumbnailUrl,
                thumbnailFileId: editingBookmark.thumbnailFileId,
                thumbnailOriginalName: editingBookmark.thumbnailOriginalName,
                tagIds: editingBookmark.tagIds,
              }
            : null
        }
        availableTags={tags}
        onSave={refresh}
      />

      <ChangePasswordModal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      <DeleteAccountModal
        open={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
      />

      <ImportBookmarksModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={() => { setImportOpen(false); refresh(); }}
      />

      <ExportBookmarksModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
