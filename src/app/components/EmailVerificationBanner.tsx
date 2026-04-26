import { useState } from 'react';
import { MailCheck, AlertTriangle } from 'lucide-react';
import { resendVerificationEmail } from '../../lib/email';

// Aligned with the server-side cooldown (resendVerification.ts: 10 minutes).
// A shorter client window would let the user click again before the server
// allows it, get 429-rejected, and see no feedback (the catch below is
// intentionally silent because the banner stays visible regardless).
const COOLDOWN_MS = 10 * 60_000;

export function EmailVerificationBanner() {
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const now = Date.now();
  const isCooling = cooldownUntil !== null && now < cooldownUntil;
  const secondsLeft = isCooling ? Math.ceil((cooldownUntil! - now) / 1000) : 0;

  const handleResend = async () => {
    if (isCooling || sending) return;
    setSending(true);
    try {
      await resendVerificationEmail();
      setCooldownUntil(Date.now() + COOLDOWN_MS);
    } catch {
      // silently ignore — the banner stays visible
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
