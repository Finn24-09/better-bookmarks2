import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import { Toaster } from "sonner";
import App from "./app/App.tsx";
import { AuthPage } from "./app/AuthPage.tsx";
import { AuthProvider } from "./app/contexts/AuthContext.tsx";
import { ProtectedRoute } from "./app/router.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <Toaster richColors position="bottom-right" />
      <Routes>
        <Route path="/" element={<ProtectedRoute><App /></ProtectedRoute>} />
        <Route path="/login" element={<AuthPage />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
