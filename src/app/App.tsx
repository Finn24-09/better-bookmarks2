import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { ManageTagsModal } from "./components/ManageTagsModal";
import { EmailVerificationBanner } from "./components/EmailVerificationBanner";
import { useBookmarks } from "./hooks/useBookmarks";
import { useAuth } from "./contexts/AuthContext";
import { RecoveryModal } from "./components/RecoveryModal";
import { refreshAfterVerify } from "../lib/email";
import type { Bookmark } from "../lib/bookmarks";

export default function App() {
  const { partialRotation } = useAuth();
  if (partialRotation !== null) {
    return <RecoveryModal />;
  }
  return <AppContent />;
}

function useHashFragmentHandler() {
  const { setEmailVerified, applyVerifiedToken } = useAuth();
  const [deleteToken, setDeleteToken] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    // Match the bare fragment OR the fragment followed by a `?` — never use
    // a loose startsWith. See AuthPage.tsx for the unauthenticated mirror of
    // this handler and the rationale.
    if (hash === '#email-verified' || hash.startsWith('#email-verified?')) {
      const params = new URLSearchParams(hash.slice('#email-verified'.length));
      if (params.get('success') === 'true') {
        setEmailVerified(true);
        toast.success('Email verified successfully.');
        // Pick up a fresh JWT carrying email_verified=true so the
        // metadata-fetcher gate accepts the user's next /title call
        // without waiting for them to sign in again. Failures are silent
        // by design (route may be missing during a rolling deploy, or the
        // 5-minute window may have lapsed) — verification itself already
        // succeeded; the user falls back to next-sign-in refresh.
        refreshAfterVerify().then((result) => {
          if (result) applyVerifiedToken(result.token);
        });
      } else {
        toast.error('Email verification failed. The link may have expired.');
      }
    } else if (hash === '#delete-confirmed' || hash.startsWith('#delete-confirmed?')) {
      const params = new URLSearchParams(hash.slice('#delete-confirmed'.length));
      const token = params.get('token');
      if (token) setDeleteToken(token);
    }
  }, [setEmailVerified, applyVerifiedToken]);

  return { deleteToken, clearDeleteToken: () => setDeleteToken(null) };
}

function AppContent() {
  const { emailVerified } = useAuth();
  const { deleteToken, clearDeleteToken } = useHashFragmentHandler();

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
  const [manageTagsOpen, setManageTagsOpen] = useState(false);

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
  const tagNameById = useMemo(
    () => Object.fromEntries(tags.map((t) => [t.id, t.name])),
    [tags],
  );

  // Open delete modal automatically when a token arrives from the email link
  useEffect(() => {
    if (deleteToken) setDeleteAccountOpen(true);
  }, [deleteToken]);

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-purple-950 to-slate-950">
      <Header
        onChangePassword={() => setChangePasswordOpen(true)}
        onDeleteAccount={() => setDeleteAccountOpen(true)}
        onImportBookmarks={() => setImportOpen(true)}
        onExportBookmarks={() => setExportOpen(true)}
        onManageTags={() => setManageTagsOpen(true)}
      />
      {!emailVerified && <EmailVerificationBanner />}

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
        onClose={() => { setDeleteAccountOpen(false); clearDeleteToken(); }}
        initialToken={deleteToken ?? undefined}
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

      <ManageTagsModal
        open={manageTagsOpen}
        tags={tags}
        onClose={() => setManageTagsOpen(false)}
        onSave={refresh}
        onTagDeleted={(id) => {
          // Clear the active filter only if it referenced the deleted tag.
          // Driven by an explicit callback (not derived from the next tags
          // array) so the reset is deterministic regardless of fetch timing.
          if (selectedTagId === id) setSelectedTagId(null);
        }}
      />
    </div>
  );
}
