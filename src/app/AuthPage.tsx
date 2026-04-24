import { useState } from "react";
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { motion, AnimatePresence } from "motion/react";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { FloatingFooter } from "./components/FloatingFooter";
import { cn } from "./components/ui/utils";
import { signIn, signUp } from "../lib/auth";
import { deriveKey } from "../lib/crypto";
import { useAuth } from "./contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: React.ElementType;
  rightSlot?: React.ReactNode;
  error?: string;
  ref?: React.Ref<HTMLInputElement>;
}

function InputField({ icon: Icon, rightSlot, error, className, ref, ...rest }: InputFieldProps) {
  return (
    <div className="space-y-1">
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
        <input
          ref={ref}
          className={cn(
            "w-full pl-11 pr-11 py-3 bg-white/5 border rounded-2xl text-white placeholder:text-white/40",
            "focus:outline-none focus:bg-white/10 transition-all duration-300",
            error
              ? "border-red-500/60 focus:border-red-500/80"
              : "border-white/10 focus:border-white/20",
            className,
          )}
          {...rest}
        />
        {rightSlot && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
        )}
      </div>
      {error && <p className="text-xs text-red-400 pl-1">{error}</p>}
    </div>
  );
}

interface EyeToggleProps {
  show: boolean;
  onToggle: () => void;
}

function EyeToggle({ show, onToggle }: EyeToggleProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onToggle}
      className="w-7 h-7 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
    >
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
}

const primaryBtn =
  "w-full py-3 bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-full text-sm font-medium hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/30 active:scale-[0.98] transition-all duration-300 shadow-md shadow-purple-500/20 disabled:opacity-60 disabled:pointer-events-none";

const ghostBtn =
  "px-6 py-2.5 border border-white/40 text-white rounded-full hover:bg-white/10 hover:border-white/60 active:scale-95 transition-all duration-300 text-sm";

// ---------------------------------------------------------------------------
// Form types
// ---------------------------------------------------------------------------

interface LoginFields {
  email: string;
  password: string;
}

interface RegisterFields {
  email: string;
  password: string;
  confirmPassword: string;
}

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFields>();

  const onSubmit = async (data: LoginFields) => {
    setApiError("");
    try {
      const result = await signIn(data.email, data.password);
      const cryptoKey = await deriveKey(data.password, data.email);
      login(result.token, result.user_id, data.email.toLowerCase(), cryptoKey);
      onSuccess();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Sign in failed");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <InputField
        type="email"
        placeholder="Email address"
        icon={Mail}
        autoComplete="email"
        error={errors.email?.message}
        {...register("email", { required: "Email is required" })}
      />
      <div className="space-y-1">
        <InputField
          type={showPassword ? "text" : "password"}
          placeholder="Password"
          icon={Lock}
          autoComplete="current-password"
          error={errors.password?.message}
          rightSlot={
            <EyeToggle show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
          }
          {...register("password", { required: "Password is required" })}
        />
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs text-white/40 hover:text-white/70 transition-colors duration-300"
          >
            Forgot password?
          </button>
        </div>
      </div>
      {apiError && <p className="text-xs text-red-400">{apiError}</p>}
      <button type="submit" disabled={isSubmitting} className={primaryBtn}>
        {isSubmitting ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Register form
// ---------------------------------------------------------------------------

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [apiError, setApiError] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFields>();

  const onSubmit = async (data: RegisterFields) => {
    setApiError("");
    try {
      const result = await signUp(data.email, data.password);
      const cryptoKey = await deriveKey(data.password, data.email);
      login(result.token, result.user_id, data.email.toLowerCase(), cryptoKey);
      onSuccess();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Sign up failed");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <InputField
        type="email"
        placeholder="Email address"
        icon={Mail}
        autoComplete="email"
        error={errors.email?.message}
        {...register("email", { required: "Email is required" })}
      />
      <InputField
        type={showPassword ? "text" : "password"}
        placeholder="Password"
        icon={Lock}
        autoComplete="new-password"
        error={errors.password?.message}
        rightSlot={
          <EyeToggle show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
        }
        {...register("password", {
          required: "Password is required",
          minLength: { value: 12, message: "At least 12 characters" },
          validate: (v) => {
            if (!/[A-Z]/.test(v)) return "Must include an uppercase letter";
            if (!/[a-z]/.test(v)) return "Must include a lowercase letter";
            if (!/[^a-zA-Z]/.test(v)) return "Must include a number or symbol";
            return true;
          },
        })}
      />
      <InputField
        type={showConfirm ? "text" : "password"}
        placeholder="Confirm password"
        icon={Lock}
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        rightSlot={
          <EyeToggle show={showConfirm} onToggle={() => setShowConfirm((s) => !s)} />
        }
        {...register("confirmPassword", {
          required: "Please confirm your password",
          validate: (v) => v === watch("password") || "Passwords do not match",
        })}
      />
      {apiError && <p className="text-xs text-red-400">{apiError}</p>}
      <button type="submit" disabled={isSubmitting} className={primaryBtn}>
        {isSubmitting ? "Creating account…" : "Create Account"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuthPage() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);

  const handleSuccess = () => navigate("/");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center p-6">

      {/* ------------------------------------------------------------------ */}
      {/* Desktop card (md+)                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="hidden md:block relative w-full max-w-[900px] min-h-[560px] bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/10">

        {/* Login form — left half */}
        <div className="absolute inset-y-0 left-0 w-1/2 flex items-center justify-center p-10 z-0">
          <div className="w-full max-w-[280px] flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-medium text-white mb-1">Sign In</h2>
              <p className="text-sm text-white/50">Welcome back</p>
            </div>
            <LoginForm onSuccess={handleSuccess} />
          </div>
        </div>

        {/* Register form — right half */}
        <div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-center p-10 z-0">
          <div className="w-full max-w-[280px] flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-medium text-white mb-1">Create Account</h2>
              <p className="text-sm text-white/50">Start saving your bookmarks</p>
            </div>
            <RegisterForm onSuccess={handleSuccess} />
          </div>
        </div>

        {/* Sliding overlay — z-10 */}
        <motion.div
          className="absolute inset-y-0 w-1/2 z-10 bg-gradient-to-br from-purple-600 to-purple-900 flex flex-col items-center justify-center p-10 shadow-2xl"
          initial={{ left: "50%" }}
          animate={{ left: isLogin ? "50%" : "0%" }}
          transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
        >
          {/* Inner edge depth shadow */}
          <div
            className={cn(
              "absolute inset-y-0 w-8 pointer-events-none",
              isLogin
                ? "left-0 bg-gradient-to-r from-purple-900/60 to-transparent"
                : "right-0 bg-gradient-to-l from-purple-900/60 to-transparent",
            )}
          />

          {/* Brand mark */}
          <div className="mb-8 text-center">
            <div className="w-12 h-12 flex items-center justify-center mx-auto mb-3">
              <img src="/favicon.svg" alt="" className="w-10 h-10" />
            </div>
            <p className="text-white/70 text-xs tracking-widest uppercase">
              Better Bookmarks 2
            </p>
          </div>

          {/* Toggle text + button */}
          <AnimatePresence mode="wait">
            {isLogin ? (
              <motion.div
                key="overlay-login"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="flex flex-col items-center text-center gap-5"
              >
                <h2 className="text-2xl font-medium text-white">New Here?</h2>
                <p className="text-white/70 text-sm leading-relaxed max-w-[220px]">
                  Sign up and start saving your bookmarks
                </p>
                <button
                  type="button"
                  onClick={() => setIsLogin(false)}
                  className={ghostBtn}
                >
                  Sign Up →
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="overlay-register"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="flex flex-col items-center text-center gap-5"
              >
                <h2 className="text-2xl font-medium text-white">Welcome Back!</h2>
                <p className="text-white/70 text-sm leading-relaxed max-w-[220px]">
                  Sign in to access your saved bookmarks
                </p>
                <button
                  type="button"
                  onClick={() => setIsLogin(true)}
                  className={ghostBtn}
                >
                  ← Sign In
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile card (below md)                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden w-full max-w-sm">
        <motion.div
          layout
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden p-6 space-y-6 shadow-2xl shadow-purple-500/10"
        >
          {/* App name */}
          <motion.div layout="position" className="text-center">
            <div className="w-10 h-10 flex items-center justify-center mx-auto mb-3">
              <img src="/favicon.svg" alt="" className="w-10 h-10" />
            </div>
            <h1 className="text-white text-xl font-medium">Better Bookmarks 2</h1>
            <p className="text-white/50 text-sm mt-1">Your video bookmark manager</p>
          </motion.div>

          {/* Toggle tabs */}
          <motion.div
            layout="position"
            className="flex bg-white/5 border border-white/10 rounded-full p-1 gap-1"
          >
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={cn(
                "flex-1 py-2 rounded-full text-sm transition-all duration-300",
                isLogin
                  ? "bg-gradient-to-br from-purple-600 to-purple-800 text-white shadow-md shadow-purple-500/20"
                  : "text-white/50 hover:text-white/80",
              )}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={cn(
                "flex-1 py-2 rounded-full text-sm transition-all duration-300",
                !isLogin
                  ? "bg-gradient-to-br from-purple-600 to-purple-800 text-white shadow-md shadow-purple-500/20"
                  : "text-white/50 hover:text-white/80",
              )}
            >
              Sign Up
            </button>
          </motion.div>

          {/* Animated form */}
          <div className="min-h-72">
            <AnimatePresence mode="wait" initial={false}>
              {isLogin ? (
                <motion.div
                  key="mobile-login"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="space-y-4"
                >
                  <LoginForm onSuccess={handleSuccess} />
                </motion.div>
              ) : (
                <motion.div
                  key="mobile-register"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="space-y-4"
                >
                  <RegisterForm onSuccess={handleSuccess} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <FloatingFooter />
    </div>
  );
}
