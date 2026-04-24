import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { X, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { PasswordStrengthHints } from "./PasswordStrengthHints";
import { changePassword, signIn } from "../../lib/auth";
import { deriveKey } from "../../lib/crypto";
import { getBookmarks, reencryptBookmark } from "../../lib/bookmarks";
import { getTags, reencryptTag } from "../../lib/tags";
import { reencryptThumbnail } from "../../lib/thumbnails";
import { useAuth } from "../contexts/AuthContext";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

interface FormFields {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function validatePasswordComplexity(v: string): true | string {
  if (!/[A-Z]/.test(v)) return "Must include an uppercase letter";
  if (!/[a-z]/.test(v)) return "Must include a lowercase letter";
  if (!/[^a-zA-Z]/.test(v)) return "Must include a number or symbol";
  return true;
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const { email, cryptoKey, updateKey } = useAuth();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Explicit latch prevents concurrent submissions if isSubmitting resets mid-flight.
  const isRotatingRef = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormFields>();

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: FormFields) => {
    if (isRotatingRef.current) return;
    isRotatingRef.current = true;

    try {
      if (!cryptoKey || !email) throw new Error("Not authenticated");

      // Pre-flight: validate current password before any data mutation.
      // Most key-rotation failures originate here — catching wrong-password errors
      // while the DB is still untouched prevents any partial re-encryption.
      await signIn(email, data.currentPassword);

      const newKey = await deriveKey(data.newPassword, email);

      // Fetch all data to re-encrypt while we still have the current key.
      const [allBookmarks, allTags] = await Promise.all([
        getBookmarks(cryptoKey),
        getTags(cryptoKey),
      ]);

      // Re-encrypt bookmark fields (title, url, thumbnail URL).
      await Promise.all(allBookmarks.map((bm) => reencryptBookmark(bm, newKey)));

      // Re-encrypt thumbnail binary files stored in thumbnail_images.
      await Promise.all(
        allBookmarks
          .filter((bm) => bm.thumbnailFileId)
          .map((bm) => reencryptThumbnail(bm.thumbnailFileId!, cryptoKey, newKey)),
      );

      // Re-encrypt tag names (name_hmac is keyed on userId, not password — unchanged).
      await Promise.all(allTags.map((tag) => reencryptTag(tag.id, tag.name, newKey)));

      // Only update the DB password after all re-encryption succeeds.
      await changePassword(data.currentPassword, data.newPassword);

      // Switch to new key in memory.
      updateKey(newKey);

      toast.success("Password updated");
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password. Check your current password and try again.");
    } finally {
      isRotatingRef.current = false;
    }
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
            "w-full max-w-[calc(100%-2rem)] sm:max-w-md",
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
            <h2 className="text-lg font-semibold text-white">Change Password</h2>
            <DialogClose asChild>
              <button className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 active:scale-95 transition-all duration-300">
                <X className="w-4 h-4 text-white" />
              </button>
            </DialogClose>
          </div>

          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-white/70">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    placeholder="Enter current password…"
                    autoComplete="current-password"
                    className={cn(errors.currentPassword ? errorInputCls : inputCls, "pr-11")}
                    {...register("currentPassword", { required: "Required" })}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowCurrent((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.currentPassword && (
                  <p className="text-xs text-red-400">{errors.currentPassword.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-white/70">New Password</label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    placeholder="Enter new password…"
                    autoComplete="new-password"
                    className={cn(errors.newPassword ? errorInputCls : inputCls, "pr-11")}
                    {...register("newPassword", {
                      required: "Required",
                      minLength: { value: 12, message: "At least 12 characters" },
                      validate: validatePasswordComplexity,
                    })}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowNew((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.newPassword && (
                  <p className="text-xs text-red-400">{errors.newPassword.message}</p>
                )}
                <PasswordStrengthHints password={watch("newPassword") ?? ""} />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-white/70">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? "text" : "password"}
                    placeholder="Retype new password…"
                    autoComplete="new-password"
                    className={cn(errors.confirmPassword ? errorInputCls : inputCls, "pr-11")}
                    {...register("confirmPassword", {
                      required: "Required",
                      validate: (v) => v === watch("newPassword") || "Passwords do not match",
                    })}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirm((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs text-red-400">{errors.confirmPassword.message}</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 mt-6">
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
                {isSubmitting ? "Saving…" : "Save Password"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
