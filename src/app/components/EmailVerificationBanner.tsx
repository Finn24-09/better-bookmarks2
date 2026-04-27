import { useState, useEffect } from 'react';
import { MailCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { resendVerificationEmail } from '../../lib/email';

// NOTE on toast-on-error: it is safe to surface resend-failure feedback here
// because this banner only renders for an *authenticated* user — the attacker
// has already proved possession of the password before reaching this code, so
// no enumeration signal is leaked. The mirror rule applies in reverse to
// ForgotPasswordModal: that flow MUST NOT toast a server-rejection state,
// otherwise it becomes an account-existence oracle. Keep this asymmetry.

// Aligned with the server-side cooldown (resendVerification.ts: 60 s).
// Server and client must stay in sync so the user can never click before the
// server allows a resend — a mismatch lets the request 429 with no UI feedback.
const COOLDOWN_MS = 60_000;

export function EmailVerificationBanner() {
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  // Drives the per-second re-render while the cooldown is active. secondsLeft
  // is derived from Date.now(), so without a tick the label would freeze at
  // its initial value until the next click.
  const [, setTick] = useState(0);

  const now = Date.now();
  const isCooling = cooldownUntil !== null && now < cooldownUntil;
  const secondsLeft = isCooling ? Math.ceil((cooldownUntil! - now) / 1000) : 0;

  useEffect(() => {
    if (!isCooling) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isCooling]);

  const handleResend = async () => {
    if (isCooling || sending) return;
    setSending(true);
    try {
      await resendVerificationEmail();
      setCooldownUntil(Date.now() + COOLDOWN_MS);
      toast.success('Verification email sent. Please check your inbox.');
    } catch {
      toast.error('Could not resend verification email. Please try again shortly.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-2 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="text-sm text-amber-300/90 flex-1">
          Please verify your email address to secure your account.
        </p>
        <button
          type="button"
          onClick={handleResend}
          disabled={isCooling || sending}
          className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 transition-colors duration-300 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
        >
          <MailCheck className="w-3.5 h-3.5" />
          {sending ? 'Sending…' : isCooling ? `Resend in ${secondsLeft}s` : 'Resend email'}
        </button>
      </div>
    </div>
  );
}
