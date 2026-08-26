import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // O deploy usa Vercel Services + rewrites na mesma origem. Não permita que
  // um VITE_API_URL de desenvolvimento seja incorporado ao bundle público.
  define: mode === "production"
    ? { "import.meta.env.VITE_API_URL": JSON.stringify("") }
    : undefined,
  server: { port: 8080, host: true },
}));
