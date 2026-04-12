import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { X, Trash2 } from "lucide-react";
import { TagMultiSelect } from "./TagMultiSelect";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { createBookmark, updateBookmark, deleteBookmark } from "../../lib/bookmarks";
import { createTag, setBookmarkTags, Tag } from "../../lib/tags";
import { useAuth } from "../contexts/AuthContext";

interface BookmarkFormModalProps {
  open: boolean;
  onClose: () => void;
  initialData?: {
    id: string;
    title: string;
    url: string;
    thumbnailUrl: string | null;
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
  const [apiError, setApiError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
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
      setApiError("");
      setIsDeleting(false);
      reset({
        title: initialData?.title ?? "",
        url: initialData?.url ?? "",
        thumbnailUrl: initialData?.thumbnailUrl ?? "",
      });
    }
  }, [open, initialData, reset]);

  const handleClose = () => {
    reset();
    setApiError("");
    onClose();
  };

  const onSubmit = async (data: FormFields) => {
    if (!cryptoKey || !userId) return;
    setApiError("");
    try {
      const input = {
        title: data.title,
        url: data.url,
        thumbnailUrl: data.thumbnailUrl.trim() || null,
      };
      if (isEditing && initialData) {
        await updateBookmark(initialData.id, input, cryptoKey);
        await setBookmarkTags(initialData.id, selectedTagIds, initialData.tagIds);
      } else {
        const { id } = await createBookmark(input, cryptoKey, userId);
        await setBookmarkTags(id, selectedTagIds, []);
      }
      onSave();
      handleClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to save bookmark");
    }
  };

  const handleDelete = async () => {
    if (!initialData) return;
    setIsDeleting(true);
    setApiError("");
    try {
      await deleteBookmark(initialData.id);
      onSave();
      handleClose();
    } catch (err) {
      setIsDeleting(false);
      setApiError(err instanceof Error ? err.message : "Failed to delete bookmark");
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

          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-white/70">Title</label>
                <input
                  type="text"
                  placeholder="Enter bookmark title…"
                  className={errors.title ? errorInputCls : inputCls}
                  {...register("title", { required: "Title is required" })}
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
                  {...register("url", { required: "URL is required" })}
                />
                {errors.url && (
                  <p className="text-xs text-red-400">{errors.url.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-white/70">
                  Thumbnail URL <span className="text-white/40">(optional)</span>
                </label>
                <input
                  type="url"
                  placeholder="https://…"
                  className={inputCls}
                  {...register("thumbnailUrl")}
                />
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

              {apiError && <p className="text-sm text-red-400">{apiError}</p>}
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
                  className="px-6 py-2.5 bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm shadow-lg shadow-purple-500/30 disabled:opacity-60 disabled:pointer-events-none"
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
