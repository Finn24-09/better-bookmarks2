import { useState, useRef, useEffect } from "react";
import { X, AlertTriangle, Mail, Lock, Eye, EyeOff } from "lucide-react";
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
import { useAuth } from "../contexts/AuthContext";
import { requestAccountDeletion, confirmAccountDeletion } from "../../lib/email";

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
  initialToken?: string;
}

type Step = 'request' | 'confirm' | 'done';

const HOLD_MS = 3000;

export function DeleteAccountModal({ open, onClose, initialToken }: DeleteAccountModalProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(initialToken ? 'confirm' : 'request');
  const [token, setToken] = useState(initialToken ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, []);

  const handleClose = () => {
    stopHold();
    setStep(initialToken ? 'confirm' : 'request');
    setToken(initialToken ?? '');
    setPassword('');
    onClose();
  };

  const handleSendEmail = async () => {
    setIsSending(true);
    try {
      await requestAccountDeletion();
      setStep('confirm');
      toast.success('Confirmation email sent. Check your inbox — token expires in 15 minutes.');
    } catch {
      toast.error('Could not send confirmation email. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirm = async () => {
    if (!token.trim()) {
      toast.error('Please enter the token from the confirmation email.');
      return;
    }
    if (!password) {
      toast.error('Please enter your password.');
      return;
    }
    setIsDeleting(true);
    const result = await confirmAccountDeletion(token.trim(), password);
    if (result.ok) {
      logout();
      navigate('/login', { replace: true });
    } else {
      toast.error(result.error ?? 'Deletion failed. Please check your password and token.');
      setIsDeleting(false);
    }
  };

  const startHold = () => {
    if (isDeleting) return;
    holdStartRef.current = Date.now();
    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const progress = Math.min(100, (elapsed / HOLD_MS) * 100);
      setHoldProgress(progress);
      if (progress >= 100) {
        clearInterval(holdIntervalRef.current!);
        holdIntervalRef.current = null;
        handleConfirm();
      }
    }, 16);
  };

  const stopHold = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setHoldProgress(0);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/60" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-full max-w-[calc(100%-2rem)] sm:max-w-md",
            "bg-white/10 backdrop-blur-xl border border-red-500/20 rounded-2xl",
            "shadow-2xl shadow-red-500/20 p-6",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
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

          {/* Step 1: request email */}
          {step === 'request' && (
            <div className="space-y-5">
              <div className="flex flex-col items-center text-center space-y-3 py-2">
                <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-white font-medium">Are you absolutely sure?</p>
                <p className="text-white/60 text-sm leading-relaxed max-w-sm">
                  This action is permanent and cannot be undone. All your bookmarks and data will be
                  permanently deleted. We'll send you a confirmation token by email first.
                </p>
              </div>
              <div className="space-y-2">
                <button
                  onClick={handleSendEmail}
                  disabled={isSending}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-red-600/20 border border-red-500/30 text-red-300 text-sm rounded-full hover:bg-red-600/30 transition-all duration-300 disabled:opacity-60 disabled:pointer-events-none"
                >
                  <Mail className="w-4 h-4" />
                  {isSending ? 'Sending…' : 'Send confirmation email'}
                </button>
                <DialogClose asChild>
                  <button
                    onClick={handleClose}
                    className="w-full px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white transition-all duration-300 text-sm"
                  >
                    Cancel
                  </button>
                </DialogClose>
              </div>
            </div>
          )}

          {/* Step 2: confirm with token + password */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="flex gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                <Mail className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300/90 leading-relaxed">
                  Check your email for the confirmation token. Copy it and paste it below.
                  The token expires in <strong>15 minutes</strong>.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="delete-token" className="text-sm text-white/70">Confirmation token (from email)</label>
                  <input
                    id="delete-token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste token here…"
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300 text-sm font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="delete-password" className="text-sm text-white/70">Your password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                    <input
                      id="delete-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password…"
                      autoComplete="current-password"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl pl-11 pr-11 py-3 text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
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
              </div>

              <div className="space-y-2 pt-1">
                {/* Hold-to-confirm delete button */}
                <button
                  onMouseDown={startHold}
                  onMouseUp={stopHold}
                  onMouseLeave={stopHold}
                  onTouchStart={startHold}
                  onTouchEnd={stopHold}
                  disabled={isDeleting}
                  className="relative w-full py-3 overflow-hidden bg-red-600/30 border border-red-500/50 text-white text-sm font-medium rounded-full select-none transition-colors duration-300 disabled:opacity-60 disabled:pointer-events-none"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-red-600 rounded-full"
                    style={{ width: `${holdProgress}%`, transition: holdProgress === 0 ? 'none' : 'width 16ms linear' }}
                  />
                  <span className="relative">
                    {isDeleting
                      ? 'Deleting…'
                      : holdProgress > 0
                        ? 'Keep holding…'
                        : 'Hold to delete permanently'}
                  </span>
                </button>
                <button
                  onClick={handleClose}
                  className="w-full px-6 py-2.5 bg-white/5 border border-white/10 text-white/70 rounded-full hover:bg-white/10 hover:text-white transition-all duration-300 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
