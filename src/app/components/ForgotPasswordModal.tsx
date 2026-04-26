import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { X, Mail, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { requestPasswordReset } from '../../lib/email';

interface Props {
  onClose: () => void;
}

interface FormFields {
  email: string;
}

type State = 'idle' | 'submitting' | 'done';

export function ForgotPasswordModal({ onClose }: Props) {
  const [state, setState] = useState<State>('idle');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormFields>();

  const onSubmit = async (data: FormFields) => {
    setState('submitting');
    try {
      await requestPasswordReset(data.email);
      setState('done');
    } catch {
      // Network failures must not strand the modal in 'submitting'.
      // Use a generic message — never relay the underlying error to avoid
      // leaking transport / schema details (matches the api.ts sanitization
      // pattern). The route always returns 200 on success, so any throw here
      // is a transport-layer failure the user can retry.
      toast.error('Could not send the reset link. Please try again.');
      setState('idle');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-purple-500/10">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-xl font-medium text-white mb-1">Reset password</h2>

        {state !== 'done' ? (
          <>
            <p className="text-sm text-white/60 mb-4">
              Enter your email address and we'll send you a reset link.
            </p>
            <div className="flex gap-3 p-3 mb-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/90 leading-relaxed">
                <strong className="text-amber-300">Warning:</strong> Resetting your password will
                permanently delete all your bookmarks and tags. This cannot be undone.
              </p>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                <input
                  type="email"
                  placeholder="Email address"
                  autoComplete="email"
                  className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
                  {...register('email', { required: 'Email is required' })}
                />
              </div>
              {errors.email && (
                <p className="text-xs text-red-400 pl-1">{errors.email.message}</p>
              )}
              <button
                type="submit"
                disabled={state === 'submitting'}
                className="w-full py-3 bg-linear-to-br from-purple-600 to-purple-800 text-white rounded-full text-sm font-medium hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-60 disabled:pointer-events-none"
              >
                {state === 'submitting' ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300/90 leading-relaxed">
                <strong className="text-red-300">Important:</strong> If an account exists for that
                email, a reset link has been sent. Following that link will{' '}
                <strong>permanently delete all your bookmarks and tags</strong> — this cannot be
                undone.
              </p>
            </div>
            <p className="text-sm text-white/60">The link expires in 1 hour.</p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 bg-white/10 border border-white/20 text-white rounded-full text-sm hover:bg-white/15 transition-all duration-300"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
