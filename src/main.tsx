import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import App from "./app/App.tsx";
import { AuthPage } from "./app/AuthPage.tsx";
import { AuthProvider } from "./app/contexts/AuthContext.tsx";
import { ProtectedRoute } from "./app/router.tsx";
import "./styles/index.css";

// Glassmorphic toast palette — matches the app's bg-white/5 backdrop-blur-xl
// card style. Type-specific borders (green/red/amber) provide semantic colour
// without changing the dark background.
const toasterVars: CSSProperties = {
  "--normal-bg":      "rgba(2, 6, 23, 0.88)",
  "--normal-text":    "rgba(255, 255, 255, 0.90)",
  "--normal-border":  "rgba(255, 255, 255, 0.12)",
  "--success-bg":     "rgba(2, 6, 23, 0.88)",
  "--success-text":   "rgba(255, 255, 255, 0.90)",
  "--success-border": "rgba(74, 222, 128, 0.40)",
  "--error-bg":       "rgba(2, 6, 23, 0.88)",
  "--error-text":     "rgba(255, 255, 255, 0.90)",
  "--error-border":   "rgba(248, 113, 113, 0.40)",
  "--warning-bg":     "rgba(2, 6, 23, 0.88)",
  "--warning-text":   "rgba(255, 255, 255, 0.90)",
  "--warning-border": "rgba(251, 191, 36, 0.40)",
} as CSSProperties;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <Toaster
        position="bottom-center"
        duration={5000}
        theme="dark"
        style={toasterVars}
        toastOptions={{
          style: {
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderRadius: "1rem",
            boxShadow: "0 4px 24px rgba(0, 0, 0, 0.50), 0 0 0 1px rgba(255,255,255,0.04)",
          },
        }}
      />
      <Routes>
        <Route path="/" element={<ProtectedRoute><App /></ProtectedRoute>} />
        <Route path="/login" element={<AuthPage />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
