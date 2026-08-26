import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { ThemeProvider, useTheme } from "./hooks/useTheme";
import { registerPWA } from "./lib/pwa";
import { OfflineNotice } from "./components/mobile/OfflineNotice";
import "./index.css";

registerPWA();

function AppContent() {
  const { resolvedTheme } = useTheme();

  return (
    <AuthProvider>
      <App />
      <OfflineNotice />
      <Toaster
        position="top-center"
        richColors
        theme={resolvedTheme}
        toastOptions={{
          style: {
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-md)",
          },
        }}
      />
    </AuthProvider>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reflete mudanças vindas do WhatsApp sem precisar atualizar a página:
      // refaz ao focar a aba e a cada 15s.
      refetchOnWindowFocus: true,
      refetchInterval: 15000,
      staleTime: 5000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
