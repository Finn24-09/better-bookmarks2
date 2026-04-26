import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onClose: () => void;
}

interface FormFields {
  new_password: string;
  confirm_password: string;
}

type State = 'idle' | 'submitting';

export function ResetPasswordModal({ onClose }: Props) {
  const [state, setState] = useState<State>('idle');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormFields>();

  const onSubmit = async (data: FormFields) => {
    setState('submitting');
    try {
      const res = await fetch('/api/email/confirm-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ new_password: data.new_password }),
      });
      if (res.ok) {
        toast.success('Password reset. All your data has been deleted. Please sign in with your new password.');
        window.history.replaceState(null, '', window.location.pathname);
        onClose();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? 'Reset failed. The link may have expired.');
        setState('idle');
      }
    } catch {
      toast.error('Network error. Please try again.');
      setState('idle');
    }
  };

  const eyeBtn = "w-7 h-7 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-purple-500/10">
        <h2 className="text-xl font-medium text-white mb-4">Set new password</h2>

        <div className="flex gap-3 p-4 mb-5 bg-red-500/10 border border-red-500/30 rounded-2xl">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300/90 leading-relaxed">
            <strong className="text-red-300">All your bookmarks and tags will be permanently deleted</strong> when
            you submit this form. This cannot be undone.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            <input
              type={showPw ? 'text' : 'password'}
              placeholder="New password"
              autoComplete="new-password"
              className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              {...register('new_password', {
                required: 'Password is required',
                minLength: { value: 12, message: 'At least 12 characters' },
              })}
            />
            <button type="button" tabIndex={-1} onClick={() => setShowPw(s => !s)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${eyeBtn}`}>
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.new_password && (
            <p className="text-xs text-red-400 pl-1">{errors.new_password.message}</p>
          )}

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            <input
              type={showConfirm ? 'text' : 'password'}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
              {...register('confirm_password', {
                required: 'Please confirm your password',
                validate: v => v === watch('new_password') || 'Passwords do not match',
              })}
            />
            <button type="button" tabIndex={-1} onClick={() => setShowConfirm(s => !s)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${eyeBtn}`}>
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.confirm_password && (
            <p className="text-xs text-red-400 pl-1">{errors.confirm_password.message}</p>
          )}

          <button
            type="submit"
            disabled={state === 'submitting'}
            className="w-full py-3 bg-linear-to-br from-red-700 to-red-900 text-white rounded-full text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-60 disabled:pointer-events-none"
          >
            {state === 'submitting' ? 'Resetting…' : 'Reset password and delete all data'}
          </button>
        </form>
      </div>
    </div>
  );
}
