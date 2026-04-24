import { useEffect, useRef, useState } from "react";
import { X, AlertTriangle, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
} from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./ui/utils";
import { deleteAccount } from "../../lib/auth";
import { useAuth } from "../contexts/AuthContext";

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
}

const HOLD_DURATION = 3000; // ms

export function DeleteAccountModal({ open, onClose }: DeleteAccountModalProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [holding, setHolding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = () => {
    setHolding(false);
    setPassword("");
    onClose();
  };

  // When the hold completes, trigger deletion with the entered password.
  useEffect(() => {
    if (holding) {
      timerRef.current = setTimeout(async () => {
        setHolding(false);
        if (!password) {
          toast.error("Please enter your password to confirm deletion");
          return;
        }
        setIsDeleting(true);
        try {
          await deleteAccount(password);
          logout();
          navigate("/login", { replace: true });
        } catch (err) {
          setIsDeleting(false);
          toast.error(err instanceof Error ? err.message : "Could not delete account. Please check your password.");
        }
      }, HOLD_DURATION);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [holding, password, logout, navigate]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-full max-w-[calc(100%-2rem)] sm:max-w-md",
            "bg-white/10 backdrop-blur-xl border border-red-500/20 rounded-2xl",
            "shadow-2xl shadow-red-500/20",
            "p-6",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-white">Delete Account</h2>
            <DialogClose asChild>
              <button
                onClick={handleClose}
                className="w-9 h-9 bg-white/10 border border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 hover:scale-110 active:scale-95 transition-all duration-300"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </DialogClose>
          </div>

          {/* Warning Body */}
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <div className="space-y-2">
              <p className="text-white font-medium">Are you absolutely sure?</p>
              <p className="text-white/60 text-sm leading-relaxed max-w-sm">
                This action is permanent and cannot be undone. All your bookmarks
                and data will be permanently deleted.
              </p>
            </div>
          </div>

          {/* Password confirmation */}
          <div className="mt-5 space-y-1.5">
            <label className="text-sm text-white/70">Confirm your password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password…"
                autoComplete="current-password"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 pr-11 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="space-y-3 mt-5">
            {/* Hold-to-confirm button */}
            <button
              disabled={isDeleting}
              className={cn(
                "relative w-full overflow-hidden rounded-full px-6 py-3",
                "border border-red-500/30 text-red-300 text-sm",
                "shadow-lg shadow-red-500/20",
                "hover:border-red-500/50 hover:shadow-red-500/30",
                "select-none cursor-pointer transition-colors duration-300",
                "focus:outline-none disabled:opacity-60 disabled:pointer-events-none",
              )}
              onMouseDown={() => setHolding(true)}
              onMouseUp={() => setHolding(false)}
              onMouseLeave={() => setHolding(false)}
              onTouchStart={() => setHolding(true)}
              onTouchEnd={() => setHolding(false)}
            >
              {/* Fill layer */}
              <div
                className={cn(
                  "absolute inset-y-0 left-0 bg-red-500/25 rounded-full",
                  "transition-[width] ease-linear",
                  holding ? "w-full duration-3000" : "w-0 duration-0",
                )}
              />
              {/* Label */}
              <span className="relative z-10 flex items-center justify-center gap-2">
                <Trash2 className="w-4 h-4" />
                {isDeleting ? "Deleting…" : "Hold to permanently delete"}
              </span>
            </button>

            {/* Cancel */}
            <DialogClose asChild>
              <button
                onClick={handleClose}
                className="w-full px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white hover:scale-105 active:scale-95 transition-all duration-300 text-sm"
              >
                Cancel
              </button>
            </DialogClose>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
