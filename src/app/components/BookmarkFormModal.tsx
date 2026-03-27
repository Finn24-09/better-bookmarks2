import { useState, useEffect } from "react";
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

interface BookmarkFormModalProps {
  open: boolean;
  onClose: () => void;
  initialData?: {
    title: string;
    url: string;
    thumbnail?: string;
    tags: string[];
  } | null;
  availableTags: string[];
}

export function BookmarkFormModal({ open, onClose, initialData, availableTags }: BookmarkFormModalProps) {
  const isEditing = !!initialData;
  const [selectedTags, setSelectedTags] = useState<string[]>(initialData?.tags ?? []);

  useEffect(() => {
    if (open) setSelectedTags(initialData?.tags ?? []);
  }, [open, initialData]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
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

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-sm text-white/70">Title</label>
              <input
                type="text"
                placeholder="Enter bookmark title…"
                defaultValue={initialData?.title ?? ""}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
            </div>

            {/* URL */}
            <div className="space-y-1.5">
              <label className="text-sm text-white/70">URL</label>
              <input
                type="url"
                placeholder="https://…"
                defaultValue={initialData?.url ?? ""}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
            </div>

            {/* Thumbnail URL */}
            <div className="space-y-1.5">
              <label className="text-sm text-white/70">
                Thumbnail URL{" "}
                <span className="text-white/40">(optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://…"
                defaultValue={initialData?.thumbnail ?? ""}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <label className="text-sm text-white/70">Tags</label>
              <TagMultiSelect
                available={availableTags}
                selected={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center mt-6 gap-3">
            {/* Delete — edit mode only */}
            {isEditing && (
              <button className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full hover:bg-red-500/20 hover:scale-105 active:scale-95 transition-all duration-300 text-sm">
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}

            <div className="flex items-center gap-3 ml-auto">
              <DialogClose asChild>
                <button className="px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 text-sm">
                  Cancel
                </button>
              </DialogClose>
              <button className="px-6 py-2.5 bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm shadow-lg shadow-purple-500/30">
                Save
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
