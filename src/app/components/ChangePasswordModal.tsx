import { X } from "lucide-react";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
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

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-white/70">Current Password</label>
              <input
                type="password"
                placeholder="Enter current password…"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-white/70">New Password</label>
              <input
                type="password"
                placeholder="Enter new password…"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-white/70">Confirm New Password</label>
              <input
                type="password"
                placeholder="Retype new password…"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-6">
            <DialogClose asChild>
              <button className="px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 text-sm">
                Cancel
              </button>
            </DialogClose>
            <button className="px-6 py-2.5 bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-full hover:scale-105 active:scale-95 transition-all duration-300 text-sm shadow-lg shadow-purple-500/30">
              Save Password
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
