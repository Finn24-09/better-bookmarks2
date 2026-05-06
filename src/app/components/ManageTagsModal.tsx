import { useState, useRef, useEffect, useMemo } from "react";
import { X, Pencil, Trash2, Check, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { ApiError } from "../../lib/api";
import { updateTag, deleteTag, MAX_TAG_LENGTH, type Tag } from "../../lib/tags";
import type { Bookmark } from "../../lib/bookmarks";
import { useAuth } from "../contexts/AuthContext";

interface ManageTagsModalProps {
  open: boolean;
  tags: Tag[];
  /** Used to compute the approximate bookmark count shown in the delete confirm. */
  bookmarks: Bookmark[];
  onClose: () => void;
  /** Called after a successful rename or delete so the parent can re-fetch. */
  onSave: () => void;
  /**
   * Called with the deleted tag id so the parent can clear an active filter
   * deterministically. Decoupled from the re-fetched tag list to avoid a
   * stale-state race when the parent's `tags` prop has not yet updated.
   */
  onTagDeleted: (id: string) => void;
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'edit'; tagId: string; value: string; saving: boolean }
  | { kind: 'confirm'; tagId: string; deleting: boolean };

// Frontend-authored 409 message. PostgREST's response body must NEVER be
// surfaced here — the raw text leaks DB schema details (constraint names,
// column names) and `/tags` is not in the AUTH_RPC_PATHS allow-list in
// `src/lib/api.ts`. See the test in ManageTagsModal.test.tsx that asserts
// this exact string.
const DUPLICATE_TAG_MESSAGE = "A tag with that name already exists.";

export function ManageTagsModal({
  open,
  tags,
  bookmarks,
  onClose,
  onSave,
  onTagDeleted,
}: ManageTagsModalProps) {
  const { cryptoKey, userId } = useAuth();
  const [search, setSearch] = useState("");
  const [rowState, setRowState] = useState<RowState>({ kind: 'idle' });

  // One AbortController per modal lifetime, aborted on unmount. The modal stays
  // mounted across open/close cycles, so the controller persists; this is fine
  // because all in-flight requests are completed and cleared before the user
  // can re-trigger a row action via the saving/deleting flags on RowState.
  const abortRef = useRef<AbortController | null>(null);
  if (abortRef.current === null) {
    abortRef.current = new AbortController();
  }

  // Refs to original Pencil/Trash buttons so we can restore focus after Esc.
  const triggerRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleClose = () => {
    setRowState({ kind: 'idle' });
    setSearch("");
    onClose();
  };

  const showSearch = tags.length > 10;
  const filteredTags = useMemo(() => {
    if (!showSearch || search.trim() === "") return tags;
    const q = search.trim().toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, search, showSearch]);

  const enterEdit = (tag: Tag) => {
    setRowState({ kind: 'edit', tagId: tag.id, value: tag.name, saving: false });
  };

  const enterConfirm = (tag: Tag) => {
    setRowState({ kind: 'confirm', tagId: tag.id, deleting: false });
  };

  const exitToIdle = (focusTriggerId?: string) => {
    setRowState({ kind: 'idle' });
    if (focusTriggerId) {
      // Defer focus restoration to the next paint so React has rendered the trigger button.
      requestAnimationFrame(() => {
        triggerRefs.current.get(focusTriggerId)?.focus();
      });
    }
  };

  const handleSaveRename = async (tag: Tag) => {
    if (rowState.kind !== 'edit' || rowState.tagId !== tag.id) return;
    if (!cryptoKey || !userId) return;

    const trimmed = rowState.value.trim();
    const trimmedOriginal = tag.name.trim();
    if (
      trimmed.length === 0 ||
      trimmed.length > MAX_TAG_LENGTH ||
      trimmed === trimmedOriginal
    ) {
      return;
    }

    setRowState({ ...rowState, saving: true });
    try {
      await updateTag(tag.id, trimmed, userId, cryptoKey, {
        signal: abortRef.current?.signal,
      });
      onSave();
      setRowState({ kind: 'idle' });
    } catch (err) {
      // Aborted requests are silent — the modal is unmounting.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof ApiError && err.status === 409) {
        toast.error(DUPLICATE_TAG_MESSAGE);
      } else {
        toast.error("Could not rename tag. Please try again.");
      }
      // Preserve the typed value so the user can correct it without retyping.
      setRowState({ kind: 'edit', tagId: tag.id, value: rowState.value, saving: false });
    }
  };

  const handleConfirmDelete = async (tag: Tag) => {
    if (rowState.kind !== 'confirm' || rowState.tagId !== tag.id) return;
    setRowState({ ...rowState, deleting: true });
    try {
      await deleteTag(tag.id, { signal: abortRef.current?.signal });
      onTagDeleted(tag.id);
      onSave();
      setRowState({ kind: 'idle' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error("Could not delete tag. Please try again.");
      setRowState({ kind: 'idle' });
    }
  };

  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-full max-w-[calc(100%-2rem)] sm:max-w-lg",
            "bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl",
            "shadow-2xl shadow-purple-500/20",
            "p-6",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <DialogPrimitive.Title className="text-lg font-semibold text-white">
              Manage Tags
            </DialogPrimitive.Title>
            <DialogClose asChild>
              <button className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 active:scale-95 transition-all duration-300">
                <X className="w-4 h-4 text-white" />
              </button>
            </DialogClose>
          </div>

          {/* Search (only when many tags) */}
          {showSearch && (
            <div className="mb-3">
              <input
                type="text"
                placeholder="Search tags…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search tags"
                // Auto-focus desktop only — on mobile this would pop the keyboard
                // and obscure the modal.
                autoFocus={typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches}
                className={inputCls}
              />
            </div>
          )}

          {/* Body */}
          {tags.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="w-14 h-14 bg-white/5 border border-white/10 rounded-full flex items-center justify-center">
                <TagIcon className="w-6 h-6 text-white/30" />
              </div>
              <p className="text-white/40 text-sm">No tags yet.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto overscroll-contain divide-y divide-white/5">
              {filteredTags.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  bookmarks={bookmarks}
                  rowState={rowState}
                  setRowState={setRowState}
                  onEnterEdit={() => enterEdit(tag)}
                  onEnterConfirm={() => enterConfirm(tag)}
                  onCancelEdit={() => exitToIdle(tag.id)}
                  onSaveRename={() => handleSaveRename(tag)}
                  onConfirmDelete={() => handleConfirmDelete(tag)}
                  onCancelConfirm={() => exitToIdle(tag.id)}
                  registerTrigger={(el) => triggerRefs.current.set(tag.id, el)}
                />
              ))}
            </ul>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-white/10">
            <span className="text-xs text-white/40">
              {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
            </span>
            <DialogClose asChild>
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2.5 bg-linear-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm shadow-lg shadow-purple-500/30"
              >
                Done
              </button>
            </DialogClose>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Row component — three states: idle, edit, confirm-delete
// ---------------------------------------------------------------------------

interface TagRowProps {
  tag: Tag;
  bookmarks: Bookmark[];
  rowState: RowState;
  setRowState: (s: RowState) => void;
  onEnterEdit: () => void;
  onEnterConfirm: () => void;
  onCancelEdit: () => void;
  onSaveRename: () => void;
  onConfirmDelete: () => void;
  onCancelConfirm: () => void;
  registerTrigger: (el: HTMLButtonElement | null) => void;
}

function TagRow({
  tag,
  bookmarks,
  rowState,
  setRowState,
  onEnterEdit,
  onEnterConfirm,
  onCancelEdit,
  onSaveRename,
  onConfirmDelete,
  onCancelConfirm,
  registerTrigger,
}: TagRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = rowState.kind === 'edit' && rowState.tagId === tag.id;
  const isConfirming = rowState.kind === 'confirm' && rowState.tagId === tag.id;

  // Auto-focus + select on edit entry.
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const iconBtn =
    "w-9 h-9 bg-white/5 border border-white/10 rounded-full flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none flex-shrink-0";

  if (isEditing && rowState.kind === 'edit') {
    const trimmed = rowState.value.trim();
    const trimmedOriginal = tag.name.trim();
    const saveDisabled =
      rowState.saving ||
      trimmed.length === 0 ||
      trimmed.length > MAX_TAG_LENGTH ||
      trimmed === trimmedOriginal;

    return (
      <li className="flex items-center gap-2 py-2">
        <input
          ref={inputRef}
          type="text"
          value={rowState.value}
          onChange={(e) => setRowState({ ...rowState, value: e.target.value })}
          aria-label={`New name for ${tag.name}`}
          maxLength={MAX_TAG_LENGTH + 1}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!saveDisabled) onSaveRename();
            } else if (e.key === 'Escape') {
              // stopPropagation prevents Radix Dialog from interpreting Escape
              // as a request to close the entire modal.
              e.stopPropagation();
              e.preventDefault();
              onCancelEdit();
            }
          }}
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
        />
        <button
          type="button"
          onClick={onSaveRename}
          disabled={saveDisabled}
          aria-label="Save rename"
          className={iconBtn}
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCancelEdit}
          aria-label="Cancel rename"
          className={iconBtn}
        >
          <X className="w-4 h-4" />
        </button>
      </li>
    );
  }

  if (isConfirming && rowState.kind === 'confirm') {
    // Local UX hint, NOT a security gate. The confirm runs regardless of count;
    // the value can be stale if the parent has not re-fetched bookmarks.
    const count = bookmarks.filter((b) => b.tagIds.includes(tag.id)).length;
    return (
      <ConfirmDeleteRow
        tagName={tag.name}
        count={count}
        deleting={rowState.deleting}
        onConfirm={onConfirmDelete}
        onCancel={onCancelConfirm}
      />
    );
  }

  // Idle row
  return (
    <li className="flex items-center gap-2 py-2">
      <span className="flex-1 min-w-0 text-sm text-white/90 truncate" title={tag.name}>
        {tag.name}
      </span>
      <button
        type="button"
        ref={registerTrigger}
        onClick={onEnterEdit}
        aria-label={`Rename ${tag.name}`}
        className={iconBtn}
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onEnterConfirm}
        aria-label={`Delete ${tag.name}`}
        className={iconBtn}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Confirm-delete row — owns its own Esc capture handler.
//
// Radix's Dialog listens for Escape via document-level handlers; intercepting
// it on the row's <li> via React's onKeyDown is not enough because focus may
// not be inside the row when the user presses Esc (e.g. after the trash click,
// focus lands on body). A capture-phase document listener catches it first
// and stops propagation so the Dialog does not interpret it as "close modal".
// ---------------------------------------------------------------------------
interface ConfirmDeleteRowProps {
  tagName: string;
  count: number;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDeleteRow({
  tagName,
  count,
  deleting,
  onConfirm,
  onCancel,
}: ConfirmDeleteRowProps) {
  useEffect(() => {
    // Window capture phase fires before document capture, so this intercepts
    // the keystroke before Radix Dialog's internal handler runs. Use
    // stopImmediatePropagation to block any same-target listener that may
    // have been registered earlier in the same phase.
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onCancel]);

  return (
    <li role="alert" className="py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex-1 min-w-0 text-sm text-white/80">
          <div className="truncate">
            Delete <span className="text-white" title={tagName}>"{tagName}"</span>?
          </div>
          <div className="text-xs text-white/50 mt-0.5">
            Removed from {count} {count === 1 ? 'bookmark' : 'bookmarks'} (approx.)
          </div>
        </div>
        <div className="flex items-center gap-2 sm:flex-shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-2 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 text-sm disabled:opacity-40 disabled:pointer-events-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 bg-red-500/80 border border-red-500/60 text-white rounded-full hover:bg-red-500 hover:scale-105 active:scale-95 transition-all duration-300 text-sm disabled:opacity-40 disabled:pointer-events-none"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  );
}
