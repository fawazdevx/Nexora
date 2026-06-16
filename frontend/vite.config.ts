import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  server: {
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  build: {
    // Split a few stable, independent leaf libraries into their own cacheable
    // chunks. We intentionally do NOT group the wallet/web3 stack: Vite already
    // lazy-loads its heavy pieces (MetaMask SDK, locale bundles) on demand, and
    // forcing them into a manual chunk would make them eager and bloat first load.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          "motion-vendor": ["framer-motion"],
          "query-vendor": ["@tanstack/react-query"],
          "icons-vendor": ["lucide-react"]
        }
      }
    }
  }
});
