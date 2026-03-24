import { useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Mail, Lock, Eye, EyeOff, Bookmark } from "lucide-react";
import { FloatingFooter } from "./components/FloatingFooter";
import { cn } from "./components/ui/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InputFieldProps {
  type: string;
  placeholder: string;
  icon: React.ElementType;
  rightSlot?: React.ReactNode;
}

function InputField({ type, placeholder, icon: Icon, rightSlot }: InputFieldProps) {
  return (
    <div className="relative">
      <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
      <input
        type={type}
        placeholder={placeholder}
        className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-2xl text-white placeholder:text-white/40 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all duration-300"
      />
      {rightSlot && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
      )}
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
      onClick={onToggle}
      className="w-7 h-7 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors duration-300"
    >
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
}

const primaryBtn =
  "w-full py-3 bg-gradient-to-br from-purple-600 to-purple-800 text-white rounded-full text-sm font-medium hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/30 active:scale-[0.98] transition-all duration-300 shadow-md shadow-purple-500/20";

const ghostBtn =
  "px-6 py-2.5 border border-white/40 text-white rounded-full hover:bg-white/10 hover:border-white/60 active:scale-95 transition-all duration-300 text-sm";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AuthPage() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // ---------------------------------------------------------------------------
  // Form content blocks (shared between desktop and mobile)
  // ---------------------------------------------------------------------------

  const loginFields = (
    <div className="space-y-3">
      <InputField type="email" placeholder="Email address" icon={Mail} />
      <div className="space-y-1">
        <InputField
          type={showPassword ? "text" : "password"}
          placeholder="Password"
          icon={Lock}
          rightSlot={<EyeToggle show={showPassword} onToggle={() => setShowPassword((s) => !s)} />}
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
    </div>
  );

  const registerFields = (
    <div className="space-y-3">
      <InputField type="email" placeholder="Email address" icon={Mail} />
      <InputField
        type={showRegPassword ? "text" : "password"}
        placeholder="Password"
        icon={Lock}
        rightSlot={<EyeToggle show={showRegPassword} onToggle={() => setShowRegPassword((s) => !s)} />}
      />
      <InputField
        type={showConfirmPassword ? "text" : "password"}
        placeholder="Confirm password"
        icon={Lock}
        rightSlot={
          <EyeToggle
            show={showConfirmPassword}
            onToggle={() => setShowConfirmPassword((s) => !s)}
          />
        }
      />
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
            {loginFields}
            <button type="button" className={primaryBtn}>Sign In</button>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-white/30">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full py-3 bg-white/5 border border-white/10 text-white/70 rounded-full text-sm hover:bg-white/10 hover:text-white hover:border-white/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
            >
              Continue as guest →
            </button>
          </div>
        </div>

        {/* Register form — right half */}
        <div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-center p-10 z-0">
          <div className="w-full max-w-[280px] flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-medium text-white mb-1">Create Account</h2>
              <p className="text-sm text-white/50">Start saving your videos</p>
            </div>
            {registerFields}
            <button type="button" className={primaryBtn}>Create Account</button>
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
                : "right-0 bg-gradient-to-l from-purple-900/60 to-transparent"
            )}
          />

          {/* Brand mark — always visible */}
          <div className="mb-8 text-center">
            <div className="w-12 h-12 bg-white/15 border border-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Bookmark className="w-6 h-6 text-white" />
            </div>
            <p className="text-white/70 text-xs tracking-widest uppercase">
              Better Bookmarks 2
            </p>
          </div>

          {/* Toggle text + button — crossfades on switch */}
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
                  Sign up and start saving your favorite videos
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
            <div className="w-10 h-10 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Bookmark className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-white text-xl font-medium">Better Bookmarks 2</h1>
            <p className="text-white/50 text-sm mt-1">Your video bookmark manager</p>
          </motion.div>

          {/* Toggle tabs */}
          <motion.div layout="position" className="flex bg-white/5 border border-white/10 rounded-full p-1 gap-1">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={cn(
                "flex-1 py-2 rounded-full text-sm transition-all duration-300",
                isLogin
                  ? "bg-gradient-to-br from-purple-600 to-purple-800 text-white shadow-md shadow-purple-500/20"
                  : "text-white/50 hover:text-white/80"
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
                  : "text-white/50 hover:text-white/80"
              )}
            >
              Sign Up
            </button>
          </motion.div>

          {/* Animated form — fixed-height wrapper keeps card size stable across login/signup */}
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
                {loginFields}
                <button type="button" className={primaryBtn}>Sign In</button>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-white/30">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="w-full py-3 bg-white/5 border border-white/10 text-white/70 rounded-full text-sm hover:bg-white/10 hover:text-white hover:border-white/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
                >
                  Continue as guest →
                </button>
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
                {registerFields}
                <button type="button" className={primaryBtn}>Create Account</button>
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
