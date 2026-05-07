import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { X, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { TagMultiSelect } from "./TagMultiSelect";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { createBookmark, updateBookmark, deleteBookmark, MAX_TITLE_LENGTH, MAX_URL_LENGTH } from "../../lib/bookmarks";
import { createTag, setBookmarkTags, Tag } from "../../lib/tags";
import { uploadThumbnail, deleteThumbnailImage } from "../../lib/thumbnails";
import { useAuth } from "../contexts/AuthContext";

interface BookmarkFormModalProps {
  open: boolean;
  onClose: () => void;
  initialData?: {
    id: string;
    title: string;
    url: string;
    thumbnailUrl: string | null;
    thumbnailFileId?: string | null;
    thumbnailOriginalName?: string | null;
    tagIds: string[];
  } | null;
  availableTags: Tag[];
  onSave: () => void;
}

interface FormFields {
  title: string;
  url: string;
  thumbnailUrl: string;
}

type ThumbnailMode = "url" | "file";

export function BookmarkFormModal({
  open,
  onClose,
  initialData,
  availableTags,
  onSave,
}: BookmarkFormModalProps) {
  const { cryptoKey, userId } = useAuth();
  const isEditing = !!initialData;
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialData?.tagIds ?? []);
  const [localTags, setLocalTags] = useState<Tag[]>(availableTags);
  const [isDeleting, setIsDeleting] = useState(false);

  // Thumbnail file upload state
  const [thumbMode, setThumbMode] = useState<ThumbnailMode>(
    initialData?.thumbnailFileId ? "file" : "url",
  );
  const [pendingFileId, setPendingFileId] = useState<string | null>(
    initialData?.thumbnailFileId ?? null,
  );
  const [pendingFileName, setPendingFileName] = useState<string | null>(
    initialData?.thumbnailOriginalName ?? null,
  );
  // Tracks a file uploaded this session but not yet saved to a bookmark.
  // Cleared on save, on remove, or on cancel (triggering deletion).
  const unsavedFileIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormFields>({
    values: {
      title: initialData?.title ?? "",
      url: initialData?.url ?? "",
      thumbnailUrl: initialData?.thumbnailUrl ?? "",
    },
  });

  // Sync available tags list when the prop changes (after a new tag is created
  // globally by the parent).
  useEffect(() => {
    setLocalTags(availableTags);
  }, [availableTags]);

  // Reset form state when the modal opens.
  useEffect(() => {
    if (open) {
      setSelectedTagIds(initialData?.tagIds ?? []);
      setIsDeleting(false);
      setThumbMode(initialData?.thumbnailFileId ? "file" : "url");
      setPendingFileId(initialData?.thumbnailFileId ?? null);
      setPendingFileName(initialData?.thumbnailOriginalName ?? null);
      unsavedFileIdRef.current = null;
      reset({
        title: initialData?.title ?? "",
        url: initialData?.url ?? "",
        thumbnailUrl: initialData?.thumbnailUrl ?? "",
      });
    }
  }, [open, initialData, reset]);

  const handleClose = () => {
    // Clean up any file uploaded this session that was never saved to a bookmark.
    const idToDelete = unsavedFileIdRef.current;
    unsavedFileIdRef.current = null;
    if (idToDelete) {
      deleteThumbnailImage(idToDelete).catch(() => {}); // fire-and-forget
    }
    reset();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !cryptoKey || !userId) return;

    // If a file was already uploaded this session (not yet saved), delete it.
    if (unsavedFileIdRef.current) {
      await deleteThumbnailImage(unsavedFileIdRef.current).catch(() => {});
      unsavedFileIdRef.current = null;
    }

    try {
      const id = await uploadThumbnail(file, cryptoKey, userId);
      unsavedFileIdRef.current = id;
      setPendingFileId(id);
      setPendingFileName(file.name);
      setThumbMode("file");
    } catch {
      toast.error("Could not upload image. Please try again.");
    }
  };

  const handleRemoveThumbnail = async () => {
    // Only clean up a file uploaded in this editing session.
    // Pre-existing saved files are cleaned up by onSubmit after save is confirmed.
    if (pendingFileId && pendingFileId === unsavedFileIdRef.current) {
      await deleteThumbnailImage(pendingFileId).catch(() => {});
    }
    unsavedFileIdRef.current = null;
    setPendingFileId(null);
    setPendingFileName(null);
    setThumbMode("url");
    setValue("thumbnailUrl", "");
  };

  const onSubmit = async (data: FormFields) => {
    if (!cryptoKey || !userId) return;
    try {
      // If the user replaced or removed an existing saved thumbnail, delete the
      // old image now that the save is confirmed.
      if (initialData?.thumbnailFileId && initialData.thumbnailFileId !== pendingFileId) {
        await deleteThumbnailImage(initialData.thumbnailFileId).catch(() => {});
      }

      const input = {
        title: data.title,
        url: data.url,
        thumbnailUrl: thumbMode === "url" ? (data.thumbnailUrl.trim() || null) : null,
        thumbnailFileId: thumbMode === "file" ? pendingFileId : null,
      };
      if (isEditing && initialData) {
        await updateBookmark(initialData.id, input, cryptoKey);
        await setBookmarkTags(initialData.id, selectedTagIds, initialData.tagIds);
      } else {
        const { id } = await createBookmark(input, cryptoKey, userId);
        await setBookmarkTags(id, selectedTagIds, []);
      }
      // File is now saved — no longer needs cleanup on cancel.
      unsavedFileIdRef.current = null;
      onSave();
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save bookmark. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (!initialData) return;
    setIsDeleting(true);
    try {
      await deleteBookmark(initialData.id);
      // Delete the associated thumbnail file after the bookmark is gone.
      if (initialData.thumbnailFileId) {
        await deleteThumbnailImage(initialData.thumbnailFileId).catch(() => {});
      }
      onSave();
      handleClose();
    } catch (err) {
      setIsDeleting(false);
      toast.error(err instanceof Error ? err.message : "Could not delete bookmark. Please try again.");
    }
  };

  const handleCreateTag = async (name: string): Promise<Tag> => {
    if (!cryptoKey || !userId) throw new Error("Not authenticated");
    const tag = await createTag(name, userId, cryptoKey);
    setLocalTags((prev) => [...prev, tag]);
    return tag;
  };

  const inputCls =
    "w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300";
  const errorInputCls =
    "w-full bg-white/5 border border-red-500/60 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-red-500/80 transition-all duration-300";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60" />
        <DialogPrimitive.Content
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
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">
              {isEditing ? "Edit Bookmark" : "Add Bookmark"}
            </h2>
            <DialogClose asChild>
              <button className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 active:scale-95 transition-all duration-300">
                <X className="w-4 h-4 text-white" />
              </button>
            </DialogClose>
          </div>

          {/* Hidden file input — explicit raster MIMEs only. The canvas
              re-encode pipeline strips EXIF/scripts but defense-in-depth
              keeps SVG (and any future image MIME with a parser CVE) off
              the input boundary entirely. (M-07 / SEC-018) */}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-white/70">Title</label>
                <input
                  type="text"
                  placeholder="Enter bookmark title…"
                  className={errors.title ? errorInputCls : inputCls}
                  // +1 lets the user type one char past the cap so the inline error appears
                  // visibly, instead of the input silently swallowing keystrokes at the
                  // boundary (mirrors the ManageTagsModal rename input pattern).
                  maxLength={MAX_TITLE_LENGTH + 1}
                  {...register("title", {
                    required: "Title is required",
                    maxLength: {
                      value: MAX_TITLE_LENGTH,
                      message: `Title must be ${MAX_TITLE_LENGTH} characters or fewer`,
                    },
                  })}
                />
                {errors.title && (
                  <p className="text-xs text-red-400">{errors.title.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-white/70">URL</label>
                <input
                  type="url"
                  placeholder="https://…"
                  className={errors.url ? errorInputCls : inputCls}
                  maxLength={MAX_URL_LENGTH + 1}
                  {...register("url", {
                    required: "URL is required",
                    maxLength: {
                      value: MAX_URL_LENGTH,
                      message: `URL must be ${MAX_URL_LENGTH} characters or fewer`,
                    },
                    validate: (v) => {
                      try {
                        const u = new URL(v);
                        return u.protocol === 'http:' || u.protocol === 'https:'
                          ? true
                          : 'Only http:// or https:// URLs are allowed';
                      } catch {
                        return 'Enter a valid URL';
                      }
                    },
                  })}
                />
                {errors.url && (
                  <p className="text-xs text-red-400">{errors.url.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-white/70">
                  Thumbnail <span className="text-white/40">(optional)</span>
                </label>

                {thumbMode === "url" ? (
                  <div className="space-y-2">
                    <input
                      type="url"
                      placeholder="https://…"
                      className={errors.thumbnailUrl ? errorInputCls : inputCls}
                      maxLength={MAX_URL_LENGTH + 1}
                      {...register("thumbnailUrl", {
                        maxLength: {
                          value: MAX_URL_LENGTH,
                          message: `URL must be ${MAX_URL_LENGTH} characters or fewer`,
                        },
                        validate: (v) => {
                          if (!v) return true;
                          return /^https?:\/\//i.test(v) || "Only http:// or https:// URLs are allowed";
                        },
                      })}
                    />
                    {errors.thumbnailUrl && (
                      <p className="text-xs text-red-400">{errors.thumbnailUrl.message}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 text-sm text-white/60 hover:text-white/80 transition-colors duration-200"
                    >
                      <Upload className="w-4 h-4" aria-hidden="true" />
                      Upload image
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-2xl">
                    <span className="flex-1 text-sm text-white/80 truncate">{pendingFileName}</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded-lg hover:bg-white/10"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveThumbnail}
                      className="text-xs text-white/50 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-white/70">Tags</label>
                <TagMultiSelect
                  available={localTags}
                  selected={selectedTagIds}
                  onChange={setSelectedTagIds}
                  onCreateTag={handleCreateTag}
                />
              </div>

            </div>

            {/* Footer Buttons */}
            <div className="flex items-center mt-6 gap-3">
              {isEditing && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full hover:bg-red-500/20 hover:scale-105 active:scale-95 transition-all duration-300 text-sm disabled:opacity-60 disabled:pointer-events-none"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? "Deleting…" : "Delete"}
                </button>
              )}

              <div className="flex items-center gap-3 ml-auto">
                <DialogClose asChild>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
                  >
                    Cancel
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 bg-linear-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm shadow-lg shadow-purple-500/30 disabled:opacity-60 disabled:pointer-events-none"
                >
                  {isSubmitting ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
